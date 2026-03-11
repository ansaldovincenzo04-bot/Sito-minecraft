const express    = require("express");
const cors       = require("cors");
const bcrypt     = require("bcrypt");
const jwt        = require("jsonwebtoken");
const multer     = require("multer");
const mongoose   = require("mongoose");
const cloudinary = require("cloudinary").v2;
const stream     = require("stream");
const path       = require("path");
require("dotenv").config();

const app    = express();
const PORT   = process.env.PORT || 3000;
const HOST   = "0.0.0.0";
const SECRET = process.env.JWT_SECRET || "hunters_universe_secret";

// ── CLOUDINARY ────────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer usa memoria (non disco) — poi carichiamo su Cloudinary manualmente
const upload = multer({ storage: multer.memoryStorage() });

// Carica buffer su Cloudinary e restituisce { url, public_id }
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => err ? reject(err) : resolve({ url: result.secure_url, public_id: result.public_id })
    );
    const readable = new stream.PassThrough();
    readable.end(buffer);
    readable.pipe(uploadStream);
  });
}

// ── MONGODB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB connesso"))
  .catch(err => console.error("Errore MongoDB:", err));

// ── SCHEMI ────────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true },
  password:     { type: String, required: true },
  profileImage: { type: String, default: "" }, // URL Cloudinary
});

const PostSchema = new mongoose.Schema({
  id:     { type: Number, default: () => Date.now() },
  author: String,
  title:  String,
  image:  String, // URL Cloudinary o URL esterno
  cloudinaryId: String, // per eliminazione
}, { timestamps: true });

const FriendSchema = new mongoose.Schema({
  from:   String,
  to:     String,
  status: { type: String, enum: ["pending","accepted"], default: "pending" }
});

const CommentSchema = new mongoose.Schema({
  id:        { type: Number, default: () => Date.now() },
  postId:    Number,
  author:    String,
  text:      String,
  createdAt: { type: Date, default: Date.now }
});

const ReactionSchema = new mongoose.Schema({
  commentId: Number,
  username:  String,
  reaction:  { type: String, enum: ["up","down"] }
});

const DeletedCommentSchema = new mongoose.Schema({
  id:          Number,
  postId:      Number,
  author:      String,
  text:        String,
  createdAt:   Date,
  deletedAt:   { type: Date, default: Date.now },
  deletedBy:   String,
  deletedFrom: String,
  postTitle:   String,
  postAuthor:  String,
});

const FeedbackSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  category:  { type: String, default: "altro" },
  username:  { type: String, default: "anonimo" },
  createdAt: { type: Date, default: Date.now },
  read:      { type: Boolean, default: false }
});

const User           = mongoose.model("User",           UserSchema);
const Post           = mongoose.model("Post",           PostSchema);
const Friend         = mongoose.model("Friend",         FriendSchema);
const Comment        = mongoose.model("Comment",        CommentSchema);
const Reaction       = mongoose.model("Reaction",       ReactionSchema);
const DeletedComment = mongoose.model("DeletedComment", DeletedCommentSchema);
const Feedback       = mongoose.model("Feedback",       FeedbackSchema);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Route esplicita per la home
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function auth(req, res, next) {
  const token = req.headers.authorization;
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).send(); }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.get("/auth/verify", auth, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(401).send("Utente non trovato");
  res.json({ username: user.username, profileImage: user.profileImage });
});

app.post("/register", upload.single("profileImage"), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Compila tutti i campi obbligatori");
  if (await User.findOne({ username })) return res.status(400).send("Lo username esiste già");
  const hash = await bcrypt.hash(password, 10);
  let profileImage = "";
  if (req.file) {
    const uploaded = await uploadToCloudinary(req.file.buffer, "hunters/profiles");
    profileImage = uploaded.url;
  }
  await User.create({ username, password: hash, profileImage });
  res.status(201).json({ ok: true });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(401).send("Inserisci tutti i dati");
  const user = await User.findOne({ username });
  if (!user) return res.status(401).send("Username errato");
  if (!await bcrypt.compare(password, user.password)) return res.status(401).send("Password errata");
  const token = jwt.sign({ username: user.username }, SECRET);
  res.json({ token, username: user.username, profileImage: user.profileImage });
});

app.post("/update-profile", auth, upload.single("profileImage"), async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).send("Utente non trovato");

  // Aggiorna immagine profilo
  if (req.file) {
    // Elimina vecchia immagine da Cloudinary
    if (user.profileImage && user.profileImage.includes("cloudinary")) {
      const pid = user.profileImage.split("/").slice(-2).join("/").split(".")[0];
      await cloudinary.uploader.destroy(pid).catch(() => {});
    }
    const uploaded = await uploadToCloudinary(req.file.buffer, "hunters/profiles");
    user.profileImage = uploaded.url;
  }

  // Aggiorna username
  const oldN = req.user.username, newN = req.body.username;
  if (newN && newN !== oldN) {
    user.username = newN;
    await Post.updateMany({ author: oldN }, { author: newN });
    await Friend.updateMany({ from: oldN }, { from: newN });
    await Friend.updateMany({ to: oldN },   { to: newN });
    await Comment.updateMany({ author: oldN }, { author: newN });
    await Reaction.updateMany({ username: oldN }, { username: newN });
  }

  await user.save();
  const token = jwt.sign({ username: user.username }, SECRET);
  res.json({ token, username: user.username, profileImage: user.profileImage });
});

// ── POSTS ─────────────────────────────────────────────────────────────────────

app.get("/posts", async (req, res) => {
  const posts = await Post.find().sort({ id: 1 });
  res.json(posts);
});

app.post("/posts", auth, upload.single("image"), async (req, res) => {
  let image = req.body.imageUrl || "";
  let cloudinaryId = null;
  if (req.file) {
    try {
      const uploaded = await uploadToCloudinary(req.file.buffer, "hunters/posts");
      image = uploaded.url;
      cloudinaryId = uploaded.public_id;
    } catch (err) {
      console.error("Errore upload Cloudinary:", err);
      return res.status(500).send("Errore caricamento immagine");
    }
  }
  const post = await Post.create({
    id: Date.now(), author: req.user.username,
    title: req.body.title, image, cloudinaryId
  });
  res.json(post);
});

app.delete("/posts/:id", auth, async (req, res) => {
  const post = await Post.findOne({ id: Number(req.params.id) });
  if (post && post.cloudinaryId) {
    await cloudinary.uploader.destroy(post.cloudinaryId).catch(() => {});
  }
  await Post.deleteOne({ id: Number(req.params.id) });
  await Comment.deleteMany({ postId: Number(req.params.id) });
  res.send("ok");
});

// ── COMMENTI ──────────────────────────────────────────────────────────────────

app.get("/posts/:id/comments", async (req, res) => {
  const me = req.headers.authorization
    ? (() => { try { return jwt.verify(req.headers.authorization, SECRET).username; } catch { return null; } })()
    : null;

  const comments  = await Comment.find({ postId: Number(req.params.id) }).sort({ createdAt: 1 });
  const reactions = await Reaction.find({ commentId: { $in: comments.map(c => c.id) } });

  const result = await Promise.all(comments.map(async c => {
    const u  = await User.findOne({ username: c.author });
    const cr = reactions.filter(r => r.commentId === c.id);
    return {
      id: c.id, postId: c.postId, author: c.author, text: c.text, createdAt: c.createdAt,
      profileImage: u ? u.profileImage : "",
      ups:   cr.filter(r => r.reaction === "up").length,
      downs: cr.filter(r => r.reaction === "down").length,
      myReaction: me ? (cr.find(r => r.username === me) || {}).reaction || null : null
    };
  }));
  res.json(result);
});

app.post("/posts/:id/comments", auth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).send("Commento vuoto");
  const comment = await Comment.create({
    id: Date.now(), postId: Number(req.params.id),
    author: req.user.username, text: text.trim()
  });
  const u = await User.findOne({ username: comment.author });
  res.json({ id: comment.id, postId: comment.postId, author: comment.author, text: comment.text,
    createdAt: comment.createdAt, profileImage: u ? u.profileImage : "", ups: 0, downs: 0, myReaction: null });
});

app.delete("/posts/:postId/comments/:commentId", auth, async (req, res) => {
  const commentId = Number(req.params.commentId);
  const postId    = Number(req.params.postId);
  const deletedBy = req.user.username;

  const comment = await Comment.findOne({ id: commentId });
  if (!comment) return res.status(404).send("Commento non trovato");

  const post         = await Post.findOne({ id: postId });
  const isPostAuthor = post && post.author === deletedBy;
  if (comment.author !== deletedBy && !isPostAuthor) return res.status(403).send("Non autorizzato");

  await DeletedComment.create({
    ...comment.toObject(),
    deletedAt: new Date(), deletedBy,
    deletedFrom: isPostAuthor && comment.author !== deletedBy ? "post_owner" : "self",
    postTitle:  post ? post.title  : "",
    postAuthor: post ? post.author : ""
  });

  await Comment.deleteOne({ id: commentId });
  res.send("ok");
});

// ── REACTIONS ─────────────────────────────────────────────────────────────────

app.post("/posts/:postId/comments/:commentId/react", auth, async (req, res) => {
  const { reaction } = req.body;
  if (!["up","down"].includes(reaction)) return res.status(400).send("Reazione non valida");
  const username  = req.user.username;
  const commentId = Number(req.params.commentId);

  const existing = await Reaction.findOne({ commentId, username });
  if (existing) {
    if (existing.reaction === reaction) await Reaction.deleteOne({ _id: existing._id });
    else { existing.reaction = reaction; await existing.save(); }
  } else {
    await Reaction.create({ commentId, username, reaction });
  }

  const cr = await Reaction.find({ commentId });
  res.json({
    ups:   cr.filter(r => r.reaction === "up").length,
    downs: cr.filter(r => r.reaction === "down").length,
    myReaction: (cr.find(r => r.username === username) || {}).reaction || null
  });
});

// ── USERS ─────────────────────────────────────────────────────────────────────

app.get("/users/profile/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).send("Utente non trovato");

  const posts    = await Post.find({ author: req.params.username }).sort({ id: 1 });
  const comments = await Comment.find({ author: req.params.username });
  const ids      = comments.map(c => c.id);
  const reactions = await Reaction.find({ commentId: { $in: ids } });

  res.json({
    username:     user.username,
    profileImage: user.profileImage,
    posts,
    totalUps:   reactions.filter(r => r.reaction === "up").length,
    totalDowns: reactions.filter(r => r.reaction === "down").length
  });
});

app.get("/users/search", auth, async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).send("Username mancante");
  const found = await User.findOne({ username, $and: [{ username: { $ne: req.user.username } }] });
  if (!found) return res.status(404).send("Utente non trovato");
  res.json({ username: found.username, profileImage: found.profileImage });
});

// ── FRIENDS ───────────────────────────────────────────────────────────────────

app.get("/friends/data", auth, async (req, res) => {
  const me      = req.user.username;
  const friends = await Friend.find({ $or: [{ from: me }, { to: me }] });
  const result  = { friends: [], pendingSent: [], pendingReceived: [] };
  friends.forEach(f => {
    if (f.status === "accepted")
      result.friends.push(f.from === me ? f.to : f.from);
    else if (f.status === "pending") {
      if (f.from === me) result.pendingSent.push(f.to);
      if (f.to   === me) result.pendingReceived.push(f.from);
    }
  });
  res.json(result);
});

app.delete("/friends/:username", auth, async (req, res) => {
  const me = req.user.username, other = req.params.username;
  await Friend.deleteMany({ $or: [{ from: me, to: other }, { from: other, to: me }] });
  res.json({ ok: true });
});

app.post("/friends/request", auth, async (req, res) => {
  const from = req.user.username, { to } = req.body;
  if (!to || to === from) return res.status(400).send("Destinatario non valido");
  if (!await User.findOne({ username: to })) return res.status(404).send("Utente non trovato");
  const exists = await Friend.findOne({ $or: [{ from, to }, { from: to, to: from }] });
  if (exists) return res.status(409).send("Richiesta già esistente o già amici");
  await Friend.create({ from, to, status: "pending" });
  res.json({ ok: true });
});

app.post("/friends/accept", auth, async (req, res) => {
  const me = req.user.username, { from } = req.body;
  const f  = await Friend.findOne({ from, to: me, status: "pending" });
  if (!f) return res.status(404).send("Richiesta non trovata");
  f.status = "accepted"; await f.save();
  res.json({ ok: true });
});

app.post("/friends/reject", auth, async (req, res) => {
  const me = req.user.username, { from } = req.body;
  await Friend.deleteOne({ from, to: me, status: "pending" });
  res.json({ ok: true });
});

// ── FEEDBACK ─────────────────────────────────────────────────────────────────

app.post("/feedback", async (req, res) => {
  const { text, category } = req.body;
  if (!text || !text.trim()) return res.status(400).send("Testo mancante");
  let username = "anonimo";
  if (req.headers.authorization) {
    try { username = jwt.verify(req.headers.authorization, SECRET).username; } catch {}
  }
  await Feedback.create({ text: text.trim(), category: category || "altro", username });
  res.json({ ok: true });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────
// Accesso tramite ?key=ADMIN_KEY nella query string

const ADMIN_KEY = process.env.ADMIN_KEY || "hunters_admin_2024";

app.get("/admin", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  res.send(`<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin – Hunters Universe</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #090b11; color: #e8eaf0; min-height: 100vh; padding: 32px 20px; }
  h1 { font-size: 26px; font-weight: 700; color: #ffb830; margin-bottom: 6px; letter-spacing: 1px; }
  p.sub { color: #6b7280; font-size: 14px; margin-bottom: 28px; }
  .stats { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 30px; }
  .stat { background: #10131c; border: 1px solid rgba(255,255,255,0.07); border-radius: 12px; padding: 16px 22px; }
  .stat-num { font-size: 28px; font-weight: 700; color: #ffb830; }
  .stat-label { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .cards { display: flex; flex-direction: column; gap: 12px; }
  .card { background: #10131c; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; padding: 18px; }
  .card.unread { border-color: rgba(240,154,0,0.3); background: #13160f; }
  .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .cat { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
  .cat.suggerimento { background: rgba(88,101,242,0.15); color: #8891f2; }
  .cat.bug { background: rgba(239,68,68,0.15); color: #f87171; }
  .cat.complimento { background: rgba(240,154,0,0.15); color: #ffb830; }
  .cat.altro { background: rgba(107,114,128,0.15); color: #9ca3af; }
  .meta { font-size: 12px; color: #6b7280; text-align: right; line-height: 1.6; }
  .text { font-size: 15px; color: #d1d5db; line-height: 1.6; }
  .unread-dot { display: inline-block; width: 8px; height: 8px; background: #f09a00; border-radius: 50%; margin-right: 6px; }
  .filters { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .filter-btn { padding: 5px 14px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); background: none; color: #9ca3af; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
  .filter-btn.active, .filter-btn:hover { border-color: #f09a00; color: #ffb830; }
  .empty { text-align: center; padding: 40px; color: #4b5268; }
</style>
</head>
<body>
<h1>🏹 Hunters Universe — Admin</h1>
<p class="sub">Pannello feedback della community</p>
<div class="stats" id="stats"></div>
<div class="filters" id="filters"></div>
<div class="cards" id="cards"></div>
<script>
const KEY = new URLSearchParams(location.search).get('key');
let allFeedback = [], currentFilter = 'tutti';

async function load() {
  const r = await fetch('/admin/feedback?key=' + KEY);
  allFeedback = await r.json();
  renderStats();
  renderFilters();
  render();
}

function renderStats() {
  const cats = ['suggerimento','bug','complimento','altro'];
  const unread = allFeedback.filter(f => !f.read).length;
  document.getElementById('stats').innerHTML =
    '<div class="stat"><div class="stat-num">' + allFeedback.length + '</div><div class="stat-label">Totale</div></div>' +
    '<div class="stat"><div class="stat-num" style="color:#f87171">' + unread + '</div><div class="stat-label">Non letti</div></div>' +
    cats.map(c => '<div class="stat"><div class="stat-num">' + allFeedback.filter(f=>f.category===c).length + '</div><div class="stat-label">' + c + '</div></div>').join('');
}

function renderFilters() {
  const cats = ['tutti','suggerimento','bug','complimento','altro'];
  document.getElementById('filters').innerHTML = cats.map(c =>
    '<button class="filter-btn' + (c===currentFilter?' active':'') + '" onclick="setFilter('' + c + '')">' + c.charAt(0).toUpperCase()+c.slice(1) + '</button>'
  ).join('');
}

function setFilter(f) { currentFilter = f; renderFilters(); render(); }

function render() {
  const list = currentFilter === 'tutti' ? allFeedback : allFeedback.filter(f=>f.category===currentFilter);
  if (!list.length) { document.getElementById('cards').innerHTML = '<div class="empty">Nessun feedback ancora.</div>'; return; }
  document.getElementById('cards').innerHTML = [...list].reverse().map(f =>
    '<div class="card' + (f.read?'':' unread') + '" onclick="markRead('' + f._id + '', this)">' +
    '<div class="card-top">' +
    '<span class="cat ' + f.category + '">' + (f.read?'':'<span class="unread-dot"></span>') + f.category + '</span>' +
    '<div class="meta">👤 ' + f.username + '<br>🕐 ' + new Date(f.createdAt).toLocaleString('it') + '</div>' +
    '</div>' +
    '<div class="text">' + f.text.replace(/</g,'&lt;') + '</div>' +
    '</div>'
  ).join('');
}

async function markRead(id, el) {
  await fetch('/admin/feedback/' + id + '/read?key=' + KEY, { method: 'POST' });
  el.classList.remove('unread');
  const f = allFeedback.find(f=>f._id===id);
  if (f) f.read = true;
  renderStats();
}

load();
</script>
</body>
</html>`);
});

app.get("/admin/feedback", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  const feedback = await Feedback.find().sort({ createdAt: -1 });
  res.json(feedback);
});

app.post("/admin/feedback/:id/read", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  await Feedback.findByIdAndUpdate(req.params.id, { read: true });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => console.log(`SITO ATTIVO: http://${HOST}:${PORT}`));