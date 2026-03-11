const express    = require("express");
const cors       = require("cors");
const bcrypt     = require("bcrypt");
const jwt        = require("jsonwebtoken");
const multer     = require("multer");
const mongoose   = require("mongoose");
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
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

// Storage per immagini post
const postStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: "hunters/posts", allowed_formats: ["jpg","jpeg","png","gif","webp"] }
});

// Storage per immagini profilo
const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: { folder: "hunters/profiles", allowed_formats: ["jpg","jpeg","png","gif","webp"] }
});

const uploadPost    = multer({ storage: postStorage });
const uploadProfile = multer({ storage: profileStorage });

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

const User           = mongoose.model("User",           UserSchema);
const Post           = mongoose.model("Post",           PostSchema);
const Friend         = mongoose.model("Friend",         FriendSchema);
const Comment        = mongoose.model("Comment",        CommentSchema);
const Reaction       = mongoose.model("Reaction",       ReactionSchema);
const DeletedComment = mongoose.model("DeletedComment", DeletedCommentSchema);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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

app.post("/register", uploadProfile.single("profileImage"), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Compila tutti i campi obbligatori");
  if (await User.findOne({ username })) return res.status(400).send("Lo username esiste già");
  const hash = await bcrypt.hash(password, 10);
  const profileImage = req.file ? req.file.path : "";
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

app.post("/update-profile", auth, uploadProfile.single("profileImage"), async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).send("Utente non trovato");

  // Aggiorna immagine profilo
  if (req.file) {
    // Elimina vecchia immagine da Cloudinary se era di Cloudinary
    if (user.profileImage && user.profileImage.includes("cloudinary")) {
      const pid = user.profileImage.split("/").pop().split(".")[0];
      await cloudinary.uploader.destroy(`hunters/profiles/${pid}`).catch(() => {});
    }
    user.profileImage = req.file.path;
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

app.post("/posts", auth, uploadPost.single("image"), async (req, res) => {
  const image        = req.file ? req.file.path : req.body.imageUrl;
  const cloudinaryId = req.file ? req.file.filename : null;
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

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => console.log(`SITO ATTIVO: http://${HOST}:${PORT}`));