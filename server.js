const express    = require("express");
const cors       = require("cors");
const bcrypt     = require("bcrypt");
const jwt        = require("jsonwebtoken");
const multer     = require("multer");
const mongoose   = require("mongoose");
const cloudinary = require("cloudinary").v2;
const stream     = require("stream");
const path       = require("path");
const https      = require("https");
const http       = require("http");
require("dotenv").config();

const app    = express();
const PORT   = process.env.PORT || 3000;
const HOST   = "0.0.0.0";
const SECRET = process.env.JWT_SECRET || "hunters_universe_secret";
const ADMIN_KEY = process.env.ADMIN_KEY || "hunters_admin_2024";

// ── CLOUDINARY ────────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const us = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => err ? reject(err) : resolve({ url: result.secure_url, public_id: result.public_id })
    );
    const r = new stream.PassThrough();
    r.end(buffer); r.pipe(us);
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
  profileImage: { type: String, default: "" },
  bio:          { type: String, default: "" },
  userClass:    { type: String, enum: ["hunter","guardian","warrior","fighter",""], default: "" },
  classChosen:  { type: Boolean, default: false },
});

const PostSchema = new mongoose.Schema({
  id:            { type: Number, default: () => Date.now() },
  author:        String,
  title:         String,
  image:         String,
  images:        { type: [String], default: [] },
  cloudinaryId:  String,
  cloudinaryIds: { type: [String], default: [] },
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

const PostReactionSchema = new mongoose.Schema({
  postId:   Number,
  username: String,
  reaction: { type: String, enum: ["up","down"] }
});

const DeletedCommentSchema = new mongoose.Schema({
  id: Number, postId: Number, author: String, text: String,
  createdAt: Date, deletedAt: { type: Date, default: Date.now },
  deletedBy: String, deletedFrom: String, postTitle: String, postAuthor: String,
});

const FeedbackSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  category:  { type: String, default: "altro" },
  username:  { type: String, default: "anonimo" },
  createdAt: { type: Date, default: Date.now },
  read:      { type: Boolean, default: false }
});

const NotificationSchema = new mongoose.Schema({
  to:        String,
  from:      String,
  type:      String, // "comment" | "reaction" | "friend_request" | "friend_accept" | "mention"
  postId:    Number,
  postTitle: String,
  message:   String,
  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const SavedPostSchema = new mongoose.Schema({
  username: String,
  postId:   Number,
  savedAt:  { type: Date, default: Date.now }
});

const User           = mongoose.model("User",           UserSchema);
const Post           = mongoose.model("Post",           PostSchema);
const Friend         = mongoose.model("Friend",         FriendSchema);
const Comment        = mongoose.model("Comment",        CommentSchema);
const Reaction       = mongoose.model("Reaction",       ReactionSchema);
const PostReaction   = mongoose.model("PostReaction",   PostReactionSchema);
const DeletedComment = mongoose.model("DeletedComment", DeletedCommentSchema);
const Feedback       = mongoose.model("Feedback",       FeedbackSchema);
const Notification   = mongoose.model("Notification",   NotificationSchema);
const SavedPost      = mongoose.model("SavedPost",      SavedPostSchema);

// ── HELPERS ───────────────────────────────────────────────────────────────────

function calcLevel(totalUps, totalPosts) {
  return Math.max(1, Math.floor(totalUps / 5 + totalPosts * 2));
}

function getRank(level, userClass) {
  const c = userClass || "hunter";
  const RANKS = {
    hunter:   ["Player 🏹", "Hunter 🏹",          "Supreme Hunter 🏹",   "Ultimate Hunter 🏹",   "Supreme Predator 🏹"],
    guardian: ["Player 🛡️", "Guardian 🛡️",        "Supreme Guardian 🛡️", "Ultimate Guardian 🛡️", "Bloodline Leader 🛡️"],
    warrior:  ["Player ⚔️", "Warrior ⚔️",          "Supreme Warrior ⚔️",  "Ultimate Warrior ⚔️",  "Vanquisher Warrior ⚔️"],
    fighter:  ["Player 🥊", "Fighter 🥊",           "Supreme Fighter 🥊",  "Ultimate Fighter 🥊",  "Paramount Archer 🥊"],
  };
  const ICONS = { hunter:"🏹", guardian:"🛡️", warrior:"⚔️", fighter:"🥊" };
  const ranks = RANKS[c] || RANKS.hunter;
  let tier = level < 20 ? 0 : level < 40 ? 1 : level < 80 ? 2 : level < 130 ? 3 : 4;
  return { rank: ranks[tier], icon: ICONS[c], level, tier };
}

async function getUserStats(username) {
  const posts     = await Post.find({ author: username });
  const comments  = await Comment.find({ author: username });
  const reactions = await Reaction.find({ commentId: { $in: comments.map(c => c.id) } });
  const postReacts = await PostReaction.find({ postId: { $in: posts.map(p => p.id) } });
  const totalUps   = reactions.filter(r => r.reaction === "up").length + postReacts.filter(r => r.reaction === "up").length;
  const totalDowns = reactions.filter(r => r.reaction === "down").length + postReacts.filter(r => r.reaction === "down").length;
  const level = calcLevel(totalUps, posts.length);
  return { totalUps, totalDowns, totalPosts: posts.length, level };
}

async function createNotif(to, from, type, postId, postTitle, message) {
  if (to === from) return;
  await Notification.create({ to, from, type, postId: postId||0, postTitle: postTitle||"", message });
}

function parseMentions(text) {
  return [...new Set((text.match(/@(\w+)/g) || []).map(m => m.slice(1)))];
}

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

function auth(req, res, next) {
  try { req.user = jwt.verify(req.headers.authorization, SECRET); next(); }
  catch { res.status(401).send(); }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.get("/auth/verify", auth, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(401).send();
  const stats = await getUserStats(user.username);
  const rankInfo = getRank(stats.level, user.userClass);
  res.json({ username: user.username, profileImage: user.profileImage, bio: user.bio,
    userClass: user.userClass, classChosen: user.classChosen, ...stats, ...rankInfo });
});

app.post("/register", upload.single("profileImage"), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).send("Compila tutti i campi");
  if (await User.findOne({ username })) return res.status(400).send("Username già esistente");
  const hash = await bcrypt.hash(password, 10);
  let profileImage = "";
  if (req.file) {
    const up = await uploadToCloudinary(req.file.buffer, "hunters/profiles");
    profileImage = up.url;
  }
  await User.create({ username, password: hash, profileImage });
  res.status(201).json({ ok: true });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(401).send("Inserisci tutti i dati");
  const user = await User.findOne({ username });
  if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).send("Credenziali errate");
  const stats = await getUserStats(username);
  const rankInfo = getRank(stats.level, user.userClass);
  const token = jwt.sign({ username }, SECRET);
  res.json({ token, username, profileImage: user.profileImage, bio: user.bio,
    userClass: user.userClass, classChosen: user.classChosen, ...stats, ...rankInfo });
});

app.post("/update-profile", auth, upload.single("profileImage"), async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).send();
  if (req.file) {
    if (user.profileImage?.includes("cloudinary")) {
      const pid = user.profileImage.split("/").slice(-2).join("/").split(".")[0];
      await cloudinary.uploader.destroy(pid).catch(() => {});
    }
    const up = await uploadToCloudinary(req.file.buffer, "hunters/profiles");
    user.profileImage = up.url;
  }
  if (req.body.bio !== undefined) user.bio = req.body.bio.slice(0, 200);
  const oldN = req.user.username, newN = req.body.username;
  if (newN && newN !== oldN) {
    if (await User.findOne({ username: newN })) return res.status(400).send("Username già in uso");
    user.username = newN;
    await Promise.all([
      Post.updateMany({ author: oldN }, { author: newN }),
      Friend.updateMany({ from: oldN }, { from: newN }),
      Friend.updateMany({ to: oldN }, { to: newN }),
      Comment.updateMany({ author: oldN }, { author: newN }),
      Reaction.updateMany({ username: oldN }, { username: newN }),
      SavedPost.updateMany({ username: oldN }, { username: newN }),
      Notification.updateMany({ to: oldN }, { to: newN }),
      Notification.updateMany({ from: oldN }, { from: newN }),
    ]);
  }
  await user.save();
  const stats = await getUserStats(user.username);
  const rankInfo = getRank(stats.level, user.userClass);
  const token = jwt.sign({ username: user.username }, SECRET);
  res.json({ token, username: user.username, profileImage: user.profileImage, bio: user.bio,
    userClass: user.userClass, classChosen: user.classChosen, ...stats, ...rankInfo });
});

// Scelta classe
app.post("/user/class", auth, async (req, res) => {
  const { userClass } = req.body;
  if (!["hunter","guardian","warrior","fighter"].includes(userClass))
    return res.status(400).send("Classe non valida");
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.status(404).send();
  user.userClass = userClass;
  user.classChosen = true;
  await user.save();
  res.json({ ok: true, userClass });
});

// ── POSTS ─────────────────────────────────────────────────────────────────────

app.get("/posts", async (req, res) => {
  const { search } = req.query;
  let query = {};
  if (search) query.$or = [
    { title:  { $regex: search, $options: "i" } },
    { author: { $regex: search, $options: "i" } }
  ];
  const posts = await Post.find(query).sort({ id: 1 });
  const me = req.query.me || null;
  const result = await Promise.all(posts.map(async p => {
    const pr = await PostReaction.find({ postId: p.id });
    const saved = me ? !!(await SavedPost.findOne({ username: me, postId: p.id })) : false;
    return { ...p.toObject(),
      postUps:        pr.filter(r => r.reaction === "up").length,
      postDowns:      pr.filter(r => r.reaction === "down").length,
      myPostReaction: me ? (pr.find(r => r.username === me)||{}).reaction||null : null,
      savedByMe:      saved };
  }));
  res.json(result);
});

app.post("/posts", auth, upload.array("images", 5), async (req, res) => {
  let images = [], cloudinaryIds = [];
  if (req.files?.length) {
    for (const f of req.files) {
      const up = await uploadToCloudinary(f.buffer, "hunters/posts");
      images.push(up.url); cloudinaryIds.push(up.public_id);
    }
  } else if (req.body.imageUrl) {
    images.push(req.body.imageUrl);
  }
  const post = await Post.create({
    id: Date.now(), author: req.user.username, title: req.body.title,
    image: images[0] || "", images, cloudinaryId: cloudinaryIds[0] || null, cloudinaryIds,
  });
  res.json(post);
});

app.put("/posts/:id", auth, async (req, res) => {
  const post = await Post.findOne({ id: Number(req.params.id) });
  if (!post) return res.status(404).send();
  if (post.author !== req.user.username) return res.status(403).send();
  if (req.body.title) post.title = req.body.title;
  await post.save();
  res.json(post);
});

app.delete("/posts/:id", auth, async (req, res) => {
  const post = await Post.findOne({ id: Number(req.params.id) });
  if (post) {
    for (const cid of (post.cloudinaryIds?.length ? post.cloudinaryIds : [post.cloudinaryId]).filter(Boolean))
      await cloudinary.uploader.destroy(cid).catch(() => {});
    await Post.deleteOne({ id: Number(req.params.id) });
    await Comment.deleteMany({ postId: Number(req.params.id) });
    await SavedPost.deleteMany({ postId: Number(req.params.id) });
  }
  res.send("ok");
});

// Reazione ai post
app.post("/posts/:id/react", auth, async (req, res) => {
  const { reaction } = req.body;
  if (!["up","down"].includes(reaction)) return res.status(400).send();
  const username = req.user.username, postId = Number(req.params.id);
  const existing = await PostReaction.findOne({ postId, username });
  if (existing) {
    if (existing.reaction === reaction) await PostReaction.deleteOne({ _id: existing._id });
    else { existing.reaction = reaction; await existing.save(); }
  } else {
    await PostReaction.create({ postId, username, reaction });
    if (reaction === "up") {
      const post = await Post.findOne({ id: postId });
      if (post) await createNotif(post.author, username, "reaction", postId, post.title, `${username} ha messo 👍 al tuo post "${post.title}"`);
    }
  }
  const pr = await PostReaction.find({ postId });
  res.json({ postUps: pr.filter(r=>r.reaction==="up").length, postDowns: pr.filter(r=>r.reaction==="down").length,
    myPostReaction: (pr.find(r=>r.username===username)||{}).reaction||null });
});

// Salva post
app.post("/posts/:id/save", auth, async (req, res) => {
  const username = req.user.username, postId = Number(req.params.id);
  const existing = await SavedPost.findOne({ username, postId });
  if (existing) { await SavedPost.deleteOne({ _id: existing._id }); res.json({ saved: false }); }
  else           { await SavedPost.create({ username, postId });     res.json({ saved: true });  }
});

// ── COMMENTI ──────────────────────────────────────────────────────────────────

app.get("/posts/:id/comments", async (req, res) => {
  const me = (() => { try { return jwt.verify(req.headers.authorization, SECRET).username; } catch { return null; } })();
  const comments  = await Comment.find({ postId: Number(req.params.id) }).sort({ createdAt: 1 });
  const reactions = await Reaction.find({ commentId: { $in: comments.map(c => c.id) } });
  const result = await Promise.all(comments.map(async c => {
    const u  = await User.findOne({ username: c.author });
    const cr = reactions.filter(r => r.commentId === c.id);
    return { id: c.id, postId: c.postId, author: c.author, text: c.text, createdAt: c.createdAt,
      profileImage: u?.profileImage || "",
      ups: cr.filter(r=>r.reaction==="up").length, downs: cr.filter(r=>r.reaction==="down").length,
      myReaction: me ? (cr.find(r=>r.username===me)||{}).reaction||null : null };
  }));
  res.json(result);
});

app.post("/posts/:id/comments", auth, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).send("Commento vuoto");
  const postId  = Number(req.params.id);
  const comment = await Comment.create({ id: Date.now(), postId, author: req.user.username, text: text.trim() });
  const u    = await User.findOne({ username: comment.author });
  const post = await Post.findOne({ id: postId });
  if (post) await createNotif(post.author, req.user.username, "comment", postId, post.title, `${req.user.username} ha commentato il tuo post "${post.title}"`);
  for (const m of parseMentions(text)) {
    await createNotif(m, req.user.username, "mention", postId, post?.title||"", `${req.user.username} ti ha menzionato in un commento`);
  }
  res.json({ id: comment.id, postId: comment.postId, author: comment.author, text: comment.text,
    createdAt: comment.createdAt, profileImage: u?.profileImage||"", ups: 0, downs: 0, myReaction: null });
});

app.delete("/posts/:postId/comments/:commentId", auth, async (req, res) => {
  const commentId = Number(req.params.commentId), postId = Number(req.params.postId);
  const comment = await Comment.findOne({ id: commentId });
  if (!comment) return res.status(404).send();
  const post = await Post.findOne({ id: postId });
  if (comment.author !== req.user.username && post?.author !== req.user.username) return res.status(403).send();
  await DeletedComment.create({ ...comment.toObject(), deletedAt: new Date(), deletedBy: req.user.username,
    deletedFrom: post?.author === req.user.username && comment.author !== req.user.username ? "post_owner" : "self",
    postTitle: post?.title||"", postAuthor: post?.author||"" });
  await Comment.deleteOne({ id: commentId });
  res.send("ok");
});

// ── REACTIONS ─────────────────────────────────────────────────────────────────

app.post("/posts/:postId/comments/:commentId/react", auth, async (req, res) => {
  const { reaction } = req.body;
  if (!["up","down"].includes(reaction)) return res.status(400).send();
  const username = req.user.username, commentId = Number(req.params.commentId);
  const existing = await Reaction.findOne({ commentId, username });
  if (existing) {
    if (existing.reaction === reaction) await Reaction.deleteOne({ _id: existing._id });
    else { existing.reaction = reaction; await existing.save(); }
  } else {
    await Reaction.create({ commentId, username, reaction });
    if (reaction === "up") {
      const comment = await Comment.findOne({ id: commentId });
      if (comment) await createNotif(comment.author, username, "reaction", Number(req.params.postId), "", `${username} ha messo 👍 al tuo commento`);
    }
  }
  const cr = await Reaction.find({ commentId });
  res.json({ ups: cr.filter(r=>r.reaction==="up").length, downs: cr.filter(r=>r.reaction==="down").length,
    myReaction: (cr.find(r=>r.username===username)||{}).reaction||null });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

app.get("/notifications", auth, async (req, res) => {
  res.json(await Notification.find({ to: req.user.username }).sort({ createdAt: -1 }).limit(40));
});

app.post("/notifications/read", auth, async (req, res) => {
  await Notification.updateMany({ to: req.user.username, read: false }, { read: true });
  res.json({ ok: true });
});

app.delete("/notifications/:id", auth, async (req, res) => {
  await Notification.deleteOne({ _id: req.params.id, to: req.user.username });
  res.json({ ok: true });
});

// ── USERS ─────────────────────────────────────────────────────────────────────

app.get("/users/profile/:username", async (req, res) => {
  const user = await User.findOne({ username: req.params.username });
  if (!user) return res.status(404).send();
  const posts    = await Post.find({ author: req.params.username }).sort({ id: 1 });
  const stats    = await getUserStats(req.params.username);
  const rankInfo = getRank(stats.level, user.userClass);
  res.json({ username: user.username, profileImage: user.profileImage, bio: user.bio,
    userClass: user.userClass, posts, ...stats, ...rankInfo });
});

app.get("/users/search", auth, async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).send();
  const found = await User.findOne({ username, $and: [{ username: { $ne: req.user.username } }] });
  if (!found) return res.status(404).send("Utente non trovato");
  res.json({ username: found.username, profileImage: found.profileImage });
});

// ── FRIENDS ───────────────────────────────────────────────────────────────────

app.get("/friends/data", auth, async (req, res) => {
  const me = req.user.username;
  const friends = await Friend.find({ $or: [{ from: me }, { to: me }] });
  const result  = { friends: [], pendingSent: [], pendingReceived: [] };
  friends.forEach(f => {
    if (f.status === "accepted") result.friends.push(f.from === me ? f.to : f.from);
    else if (f.from === me) result.pendingSent.push(f.to);
    else if (f.to   === me) result.pendingReceived.push(f.from);
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
  if (await Friend.findOne({ $or: [{ from, to }, { from: to, to: from }] }))
    return res.status(409).send("Già amici o richiesta pendente");
  await Friend.create({ from, to, status: "pending" });
  await createNotif(to, from, "friend_request", 0, "", `${from} vuole essere tuo amico`);
  res.json({ ok: true });
});

app.post("/friends/accept", auth, async (req, res) => {
  const me = req.user.username, { from } = req.body;
  const f  = await Friend.findOne({ from, to: me, status: "pending" });
  if (!f) return res.status(404).send();
  f.status = "accepted"; await f.save();
  await createNotif(from, me, "friend_accept", 0, "", `${me} ha accettato la tua richiesta`);
  res.json({ ok: true });
});

app.post("/friends/reject", auth, async (req, res) => {
  await Friend.deleteOne({ from: req.body.from, to: req.user.username, status: "pending" });
  res.json({ ok: true });
});

// ── LINK PREVIEW ─────────────────────────────────────────────────────────────

app.get("/link-preview", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send();
  try {
    const proto = url.startsWith("https") ? https : http;
    const data  = await new Promise((resolve, reject) => {
      const r2 = proto.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 4000 }, r => {
        let body = "";
        r.on("data", c => { body += c; if (body.length > 60000) r.destroy(); });
        r.on("end", () => resolve(body));
        r.on("error", reject);
      });
      r2.on("error", reject);
      r2.on("timeout", () => { r2.destroy(); reject(new Error("timeout")); });
    });
    const g = (re) => (data.match(re)||[])[1]||"";
    res.json({
      title:       g(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || g(/<title>([^<]+)<\/title>/i),
      description: g(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) || g(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i),
      image:       g(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i),
      domain:      new URL(url).hostname.replace("www.",""),
      url
    });
  } catch { res.status(500).json({ error: "Preview non disponibile" }); }
});

// ── FEEDBACK ─────────────────────────────────────────────────────────────────

app.post("/feedback", async (req, res) => {
  const { text, category } = req.body;
  if (!text?.trim()) return res.status(400).send("Testo mancante");
  let username = "anonimo";
  if (req.headers.authorization) {
    try { username = jwt.verify(req.headers.authorization, SECRET).username; } catch {}
  }
  await Feedback.create({ text: text.trim(), category: category || "altro", username });
  res.json({ ok: true });
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────

app.get("/admin", (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  res.send(`<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin – Hunters Universe</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#090b11;color:#e8eaf0;min-height:100vh;padding:32px 20px}h1{font-size:26px;font-weight:700;color:#ffb830;margin-bottom:6px;letter-spacing:1px}p.sub{color:#6b7280;font-size:14px;margin-bottom:28px}.stats{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:30px}.stat{background:#10131c;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:16px 22px}.stat-num{font-size:28px;font-weight:700;color:#ffb830}.stat-label{font-size:12px;color:#6b7280;margin-top:2px}.cards{display:flex;flex-direction:column;gap:12px}.card{background:#10131c;border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:18px;cursor:pointer}.card.unread{border-color:rgba(240,154,0,0.3);background:#131609}.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}.cat{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}.cat.suggerimento{background:rgba(88,101,242,0.15);color:#8891f2}.cat.bug{background:rgba(239,68,68,0.15);color:#f87171}.cat.complimento{background:rgba(240,154,0,0.15);color:#ffb830}.cat.altro{background:rgba(107,114,128,0.15);color:#9ca3af}.meta{font-size:12px;color:#6b7280;text-align:right;line-height:1.6}.text{font-size:15px;color:#d1d5db;line-height:1.6}.unread-dot{display:inline-block;width:8px;height:8px;background:#f09a00;border-radius:50%;margin-right:6px}.filters{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}.filter-btn{padding:5px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);background:none;color:#9ca3af;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.2s}.filter-btn.active,.filter-btn:hover{border-color:#f09a00;color:#ffb830}.empty{text-align:center;padding:40px;color:#4b5268}</style></head>
<body><h1>🏹 Hunters Universe — Admin</h1><p class="sub">Pannello feedback community</p>
<div class="stats" id="stats"></div><div class="filters" id="filters"></div><div class="cards" id="cards"></div>
<script>
const KEY=new URLSearchParams(location.search).get('key');
let all=[],filter='tutti';
async function load(){const r=await fetch('/admin/feedback?key='+KEY);all=await r.json();renderStats();renderFilters();render();}
function renderStats(){const cats=['suggerimento','bug','complimento','altro'];const u=all.filter(f=>!f.read).length;document.getElementById('stats').innerHTML='<div class="stat"><div class="stat-num">'+all.length+'</div><div class="stat-label">Totale</div></div><div class="stat"><div class="stat-num" style="color:#f87171">'+u+'</div><div class="stat-label">Non letti</div></div>'+cats.map(c=>'<div class="stat"><div class="stat-num">'+all.filter(f=>f.category===c).length+'</div><div class="stat-label">'+c+'</div></div>').join('');}
function renderFilters(){document.getElementById('filters').innerHTML=['tutti','suggerimento','bug','complimento','altro'].map(c=>'<button class="filter-btn'+(c===filter?' active':'')+'" onclick="setFilter(\''+c+'\')">'+c[0].toUpperCase()+c.slice(1)+'</button>').join('');}
function setFilter(f){filter=f;renderFilters();render();}
function render(){const list=filter==='tutti'?all:all.filter(f=>f.category===filter);if(!list.length){document.getElementById('cards').innerHTML='<div class="empty">Nessun feedback.</div>';return;}document.getElementById('cards').innerHTML=[...list].map(f=>'<div class="card'+(f.read?'':' unread')+'" onclick="markRead(\''+f._id+'\',this)"><div class="card-top"><span class="cat '+f.category+'">'+(f.read?'':'<span class="unread-dot"></span>')+f.category+'</span><div class="meta">👤 '+f.username+'<br>🕐 '+new Date(f.createdAt).toLocaleString('it')+'</div></div><div class="text">'+f.text.replace(/</g,'&lt;')+'</div></div>').join('');}
async function markRead(id,el){await fetch('/admin/feedback/'+id+'/read?key='+KEY,{method:'POST'});el.classList.remove('unread');const f=all.find(f=>f._id===id);if(f)f.read=true;renderStats();}
load();
</script></body></html>`);
});

app.get("/admin/feedback", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  res.json(await Feedback.find().sort({ createdAt: -1 }));
});

app.post("/admin/feedback/:id/read", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  await Feedback.findByIdAndUpdate(req.params.id, { read: true });
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => console.log(`SITO ATTIVO: http://${HOST}:${PORT}`));