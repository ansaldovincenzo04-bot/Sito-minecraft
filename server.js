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
  const posts    = await Post.find({ author: username });
  const comments = await Comment.find({ author: username });
  // Escludi le reazioni dell'utente stesso ai propri commenti
  const reactions = await Reaction.find({
    commentId: { $in: comments.map(c => c.id) },
    username:  { $ne: username }   // ← non contare self-reactions
  });
  // Escludi le reazioni dell'utente stesso ai propri post
  const postReacts = await PostReaction.find({
    postId:   { $in: posts.map(p => p.id) },
    username: { $ne: username }    // ← non contare self-reactions
  });
  const totalUps   = reactions.filter(r => r.reaction === "up").length   + postReacts.filter(r => r.reaction === "up").length;
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
    for (const cid of ((post.cloudinaryIds && post.cloudinaryIds.length ? post.cloudinaryIds : [post.cloudinaryId])).filter(Boolean))
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

// ── ADMIN API ─────────────────────────────────────────────────────────────────

app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_KEY) return res.status(403).json({ error: "Password errata" });
  const adminToken = jwt.sign({ admin: true }, SECRET + "_admin", { expiresIn: "8h" });
  res.json({ adminToken });
});

function adminAuth(req, res, next) {
  const tok = req.headers["x-admin-token"];
  try { const p = jwt.verify(tok, SECRET + "_admin"); if (p.admin) return next(); } catch {}
  res.status(403).json({ error: "Non autorizzato" });
}

app.get("/admin/stats", adminAuth, async (req, res) => {
  const [users, posts, comments, feedbacks] = await Promise.all([
    User.countDocuments(), Post.countDocuments(),
    Comment.countDocuments(), Feedback.countDocuments()
  ]);
  const unreadFeedback = await Feedback.countDocuments({ read: false });
  res.json({ users, posts, comments, feedbacks, unreadFeedback });
});

app.get("/admin/users", adminAuth, async (req, res) => {
  const users = await User.find({}, { password: 0 }).sort({ _id: -1 });
  const result = await Promise.all(users.map(async u => {
    const stats = await getUserStats(u.username);
    const rankInfo = getRank(stats.level, u.userClass);
    return { ...u.toObject(), ...stats, ...rankInfo };
  }));
  res.json(result);
});

app.delete("/admin/users/:username", adminAuth, async (req, res) => {
  const { username } = req.params;
  await User.deleteOne({ username });
  await Post.deleteMany({ author: username });
  await Comment.deleteMany({ author: username });
  await Friend.deleteMany({ $or: [{ from: username }, { to: username }] });
  res.json({ ok: true });
});

app.get("/admin/posts", adminAuth, async (req, res) => {
  res.json(await Post.find().sort({ _id: -1 }).limit(200));
});

app.delete("/admin/posts/:id", adminAuth, async (req, res) => {
  const post = await Post.findOne({ id: Number(req.params.id) });
  if (post) {
    for (const cid of ((post.cloudinaryIds && post.cloudinaryIds.length ? post.cloudinaryIds : [post.cloudinaryId])).filter(Boolean))
      await cloudinary.uploader.destroy(cid).catch(() => {});
    await Post.deleteOne({ id: Number(req.params.id) });
    await Comment.deleteMany({ postId: Number(req.params.id) });
  }
  res.json({ ok: true });
});

app.get("/admin", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="it"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🏹 Admin — Hunters Universe</title>
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:#090b11;color:#e8eaf0;min-height:100vh}
:root{--accent:#f09a00;--accent2:#ff6b35;--surface:#10131c;--surface2:#13172a;--border:rgba(255,255,255,0.07);--danger:#ef4444;--success:#22c55e}
.topbar{background:var(--surface);border-bottom:1px solid var(--border);padding:0 28px;height:58px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.logo{font-family:'Rajdhani',sans-serif;font-size:20px;font-weight:700;color:var(--accent);letter-spacing:1px}
.logout-btn{background:none;border:1px solid var(--border);color:#9ca3af;padding:5px 14px;border-radius:8px;font-size:12px;cursor:pointer;transition:all .2s}
.logout-btn:hover{border-color:var(--danger);color:var(--danger)}
.page{display:none;padding:28px;max-width:1100px;margin:0 auto}
.page.active{display:block}
/* LOGIN */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:40px;width:360px;text-align:center}
.login-icon{font-size:48px;margin-bottom:16px}
.login-title{font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:700;color:var(--accent);margin-bottom:6px}
.login-sub{color:#6b7280;font-size:13px;margin-bottom:28px}
.inp{width:100%;background:#0d1017;border:1px solid var(--border);border-radius:10px;padding:12px 16px;color:#e8eaf0;font-size:14px;outline:none;transition:border-color .2s;margin-bottom:14px}
.inp:focus{border-color:var(--accent)}
.btn{width:100%;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#000}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.err{color:#f87171;font-size:13px;margin-top:10px}
/* NAV */
.nav{background:var(--surface);border-bottom:1px solid var(--border);padding:0 28px;display:flex;gap:4px;overflow-x:auto}
.nav-btn{padding:14px 18px;background:none;border:none;color:#9ca3af;font-size:13px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nav-btn.active,.nav-btn:hover{color:var(--accent);border-bottom-color:var(--accent)}
/* STATS */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-bottom:28px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px 22px}
.stat-num{font-size:32px;font-weight:700;color:var(--accent);font-family:'Rajdhani',sans-serif}
.stat-label{font-size:12px;color:#6b7280;margin-top:4px;font-weight:500}
/* TABLE */
.section-title{font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:var(--accent);margin-bottom:14px;text-transform:uppercase;letter-spacing:.5px}
.search-bar{background:#0d1017;border:1px solid var(--border);border-radius:10px;padding:9px 16px;color:#e8eaf0;font-size:13px;outline:none;width:100%;max-width:320px;margin-bottom:16px;transition:border-color .2s}
.search-bar:focus{border-color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 14px;color:#6b7280;font-weight:600;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
td{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle}
tr:hover td{background:rgba(255,255,255,0.02)}
.avatar-sm{width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--border)}
.rank-pill{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700}
.r0{background:rgba(156,163,175,.12);color:#9ca3af}.r1{background:rgba(34,197,94,.12);color:#4ade80}.r2{background:rgba(59,130,246,.12);color:#60a5fa}.r3{background:rgba(168,85,247,.12);color:#c084fc}.r4{background:rgba(240,154,0,.15);color:#ffb830}
.class-icon{font-size:14px}
.action-btn{background:none;border:1px solid var(--border);color:#9ca3af;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;transition:all .2s}
.action-btn:hover{border-color:var(--danger);color:var(--danger)}
/* FEEDBACK */
.fb-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:10px;cursor:pointer;transition:border-color .2s}
.fb-card.unread{border-color:rgba(240,154,0,.3);background:#13160f}
.fb-card:hover{border-color:rgba(255,255,255,.15)}
.fb-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:8px}
.cat-pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
.cat-pill.suggerimento{background:rgba(88,101,242,.15);color:#8891f2}
.cat-pill.bug{background:rgba(239,68,68,.15);color:#f87171}
.cat-pill.complimento{background:rgba(240,154,0,.15);color:#ffb830}
.cat-pill.altro{background:rgba(107,114,128,.15);color:#9ca3af}
.fb-meta{font-size:11px;color:#6b7280;text-align:right;line-height:1.7}
.fb-text{font-size:14px;color:#d1d5db;line-height:1.6}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent);margin-right:6px}
.filters{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.filter-btn{padding:5px 14px;border-radius:20px;border:1px solid var(--border);background:none;color:#9ca3af;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
.filter-btn.active,.filter-btn:hover{border-color:var(--accent);color:var(--accent)}
.empty{text-align:center;padding:48px;color:#4b5268;font-size:14px}
.post-thumb{width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
.confirm-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;align-items:center;justify-content:center}
.confirm-overlay.show{display:flex}
.confirm-box{background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:28px;text-align:center;max-width:340px;width:90%}
.confirm-box h3{font-family:'Rajdhani',sans-serif;font-size:20px;margin-bottom:8px;color:#f87171}
.confirm-box p{font-size:13px;color:#9ca3af;margin-bottom:22px}
.confirm-btns{display:flex;gap:10px}
.btn-danger{flex:1;padding:10px;border:none;border-radius:8px;background:var(--danger);color:white;font-weight:700;cursor:pointer}
.btn-cancel{flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:none;color:#9ca3af;cursor:pointer}
.read-all-btn{background:none;border:1px solid var(--border);color:#9ca3af;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;transition:all .2s;margin-bottom:16px}
.read-all-btn:hover{border-color:var(--accent);color:var(--accent)}
</style></head><body>

<!-- LOGIN PAGE -->
<div id="loginPage" class="login-wrap">
  <div class="login-card">
    <div class="login-icon">🏹</div>
    <div class="login-title">HUNTERS UNIVERSE</div>
    <div class="login-sub">Pannello di Amministrazione</div>
    <input id="pwdInput" class="inp" type="password" placeholder="Password admin..." onkeydown="if(event.key==='Enter')doLogin()">
    <button class="btn btn-primary" onclick="doLogin()">Accedi</button>
    <div id="loginErr" class="err"></div>
  </div>
</div>

<!-- ADMIN PANEL -->
<div id="adminPanel" style="display:none">
  <div class="topbar">
    <div class="logo">🏹 ADMIN PANEL</div>
    <button class="logout-btn" onclick="doLogout()">Esci</button>
  </div>
  <nav class="nav">
    <button class="nav-btn active" onclick="showTab('dashboard')">📊 Dashboard</button>
    <button class="nav-btn" onclick="showTab('users')">👥 Utenti</button>
    <button class="nav-btn" onclick="showTab('posts')">🖼️ Post</button>
    <button class="nav-btn" onclick="showTab('feedback')">💬 Feedback</button>
  </nav>

  <!-- DASHBOARD -->
  <div id="tab-dashboard" class="page active">
    <div class="stats-grid" id="statsGrid"></div>
    <div class="section-title">Ultimi Post</div>
    <div id="recentPosts"></div>
  </div>

  <!-- UTENTI -->
  <div id="tab-users" class="page">
    <div class="section-title">Gestione Utenti</div>
    <input class="search-bar" id="userSearch" placeholder="🔍 Cerca username..." oninput="filterUsers()">
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Avatar</th><th>Username</th><th>Classe</th><th>Rank</th>
          <th>Lv.</th><th>Post</th><th>👍</th><th>Azioni</th>
        </tr></thead>
        <tbody id="usersTable"></tbody>
      </table>
    </div>
  </div>

  <!-- POST -->
  <div id="tab-posts" class="page">
    <div class="section-title">Gestione Post</div>
    <input class="search-bar" id="postSearch" placeholder="🔍 Cerca titolo o autore..." oninput="filterPosts()">
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Immagine</th><th>Titolo</th><th>Autore</th><th>Data</th><th>Azioni</th>
        </tr></thead>
        <tbody id="postsTable"></tbody>
      </table>
    </div>
  </div>

  <!-- FEEDBACK -->
  <div id="tab-feedback" class="page">
    <div class="section-title">Feedback Community</div>
    <button class="read-all-btn" onclick="markAllRead()">✓ Segna tutti letti</button>
    <div class="filters" id="fbFilters"></div>
    <div id="fbList"></div>
  </div>
</div>

<!-- CONFIRM DIALOG -->
<div class="confirm-overlay" id="confirmOverlay">
  <div class="confirm-box">
    <h3 id="confirmTitle">Sei sicuro?</h3>
    <p id="confirmMsg"></p>
    <div class="confirm-btns">
      <button class="btn-danger" onclick="confirmYes()">Sì, Elimina</button>
      <button class="btn-cancel" onclick="closeConfirm()">Annulla</button>
    </div>
  </div>
</div>

<script>
let adminToken = sessionStorage.getItem('adminToken');
let allUsers = [], allPosts = [], allFeedback = [];
let pendingAction = null;
let fbFilter = 'tutti';
const CLASS_ICONS = {hunter:'🏹',guardian:'🛡️',warrior:'⚔️',fighter:'🥊'};

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function doLogin() {
  const btn = document.querySelector('.btn-primary');
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const pwd = document.getElementById('pwdInput').value;
    if (!pwd) { document.getElementById('loginErr').textContent = 'Inserisci la password'; btn.textContent='Accedi'; btn.disabled=false; return; }
    const r = await fetch('/admin/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ password: pwd })
    });
    if (r.ok) {
      const d = await r.json();
      adminToken = d.adminToken;
      sessionStorage.setItem('adminToken', adminToken);
      showPanel();
    } else {
      const msg = await r.text();
      document.getElementById('loginErr').textContent = 'Password errata (' + r.status + ')';
    }
  } catch(e) {
    document.getElementById('loginErr').textContent = 'Errore di rete: ' + e.message;
  }
  btn.textContent = 'Accedi';
  btn.disabled = false;
}
function doLogout() { sessionStorage.removeItem('adminToken'); adminToken = null; document.getElementById('loginPage').style.display='flex'; document.getElementById('adminPanel').style.display='none'; }
function ah() { return { 'x-admin-token': adminToken }; }

// ── PANEL ──────────────────────────────────────────────────────────────────────
function showPanel() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'block';
  loadDashboard(); loadUsers(); loadPosts(); loadFeedback();
}

function showTab(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const r = await fetch('/admin/stats', { headers: ah() });
  if (!r.ok) return;
  const s = await r.json();
  document.getElementById('statsGrid').innerHTML =
    stat('👥', s.users, 'Utenti') + stat('🖼️', s.posts, 'Post') +
    stat('💬', s.comments, 'Commenti') + stat('📩', s.feedbacks, 'Feedback') +
    stat('🔴', s.unreadFeedback, 'Non letti');
  // Recent posts preview
  const rp = await fetch('/admin/posts', { headers: ah() });
  const posts = (await rp.json()).slice(0, 6);
  document.getElementById('recentPosts').innerHTML = posts.map(p =>
    '<div style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--surface);border-radius:10px;margin-bottom:8px;border:1px solid var(--border)">' +
    (p.image ? '<img src="'+p.image+'" style="width:48px;height:48px;object-fit:cover;border-radius:6px;" onerror="this.style.display='none'">' : '<div style="width:48px;height:48px;background:#1a1e2e;border-radius:6px;"></div>') +
    '<div><div style="font-weight:600;font-size:14px">'+esc(p.title)+'</div><div style="font-size:12px;color:#6b7280">Di '+esc(p.author)+' · '+new Date(p.createdAt).toLocaleDateString('it')+'</div></div>' +
    '<button class="action-btn" style="margin-left:auto" onclick="deletePost('+p.id+',\''+esc(p.title)+'\')">🗑️</button></div>'
  ).join('');
}
function stat(icon, num, label) {
  return '<div class="stat-card"><div class="stat-num">'+num+'</div><div class="stat-label">'+icon+' '+label+'</div></div>';
}

// ── UTENTI ──────────────────────────────────────────────────────────────────────
async function loadUsers() {
  const r = await fetch('/admin/users', { headers: ah() });
  if (!r.ok) return;
  allUsers = await r.json();
  renderUsers(allUsers);
}
function filterUsers() {
  const q = document.getElementById('userSearch').value.toLowerCase();
  renderUsers(allUsers.filter(u => u.username.toLowerCase().includes(q)));
}
function renderUsers(list) {
  const RANK_COLORS = ['r0','r1','r2','r3','r4'];
  document.getElementById('usersTable').innerHTML = list.map(u =>
    '<tr>' +
    '<td><img class="avatar-sm" src="'+(u.profileImage||'/uploads/default-avatar.png')+'" onerror="this.src=\'/uploads/default-avatar.png\'"></td>' +
    '<td style="font-weight:600">'+esc(u.username)+'</td>' +
    '<td><span class="class-icon">'+(CLASS_ICONS[u.userClass]||'❓')+'</span> '+cap(u.userClass||'—')+'</td>' +
    '<td><span class="rank-pill '+RANK_COLORS[u.tier||0]+'">'+esc(u.rank||'Player')+'</span></td>' +
    '<td><strong>'+u.level+'</strong></td>' +
    '<td>'+u.totalPosts+'</td>' +
    '<td style="color:#4ade80">'+u.totalUps+'</td>' +
    '<td><button class="action-btn" onclick="deleteUser(\''+esc(u.username)+'\')">🗑️ Elimina</button></td>' +
    '</tr>'
  ).join('') || '<tr><td colspan="8" style="text-align:center;color:#4b5268;padding:28px">Nessun utente</td></tr>';
}

// ── POST ──────────────────────────────────────────────────────────────────────
async function loadPosts() {
  const r = await fetch('/admin/posts', { headers: ah() });
  if (!r.ok) return;
  allPosts = await r.json();
  renderPosts(allPosts);
}
function filterPosts() {
  const q = document.getElementById('postSearch').value.toLowerCase();
  renderPosts(allPosts.filter(p => (p.title||'').toLowerCase().includes(q) || (p.author||'').toLowerCase().includes(q)));
}
function renderPosts(list) {
  document.getElementById('postsTable').innerHTML = list.map(p =>
    '<tr>' +
    '<td>'+(p.image?'<img class="post-thumb" src="'+p.image+'" onerror="this.style.display='none'">':'—')+'</td>' +
    '<td style="font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(p.title||'—')+'</td>' +
    '<td>'+esc(p.author)+'</td>' +
    '<td style="color:#6b7280">'+new Date(p.createdAt).toLocaleDateString('it')+'</td>' +
    '<td><button class="action-btn" onclick="deletePost('+p.id+',\''+esc(p.title)+'\')">🗑️</button></td>' +
    '</tr>'
  ).join('') || '<tr><td colspan="5" style="text-align:center;color:#4b5268;padding:28px">Nessun post</td></tr>';
}

// ── FEEDBACK ──────────────────────────────────────────────────────────────────
async function loadFeedback() {
  const r = await fetch('/admin/feedback?key='+encodeURIComponent(sessionStorage.getItem('adminToken')), { headers: ah() });
  // fallback: usa endpoint con adminAuth
  const r2 = await fetch('/admin/feedback-list', { headers: ah() });
  if (r2.ok) { allFeedback = await r2.json(); } else if (r.ok) { allFeedback = await r.json(); }
  renderFeedback();
}
function renderFbFilters() {
  const cats = ['tutti','suggerimento','bug','complimento','altro'];
  document.getElementById('fbFilters').innerHTML = cats.map(c =>
    '<button class="filter-btn'+(c===fbFilter?' active':'')+'" onclick="setFbFilter(\''+c+'\')">'+cap(c)+'</button>'
  ).join('');
}
function setFbFilter(f) { fbFilter = f; renderFeedback(); }
function renderFeedback() {
  renderFbFilters();
  const list = fbFilter === 'tutti' ? allFeedback : allFeedback.filter(f => f.category === fbFilter);
  if (!list.length) { document.getElementById('fbList').innerHTML = '<div class="empty">Nessun feedback.</div>'; return; }
  document.getElementById('fbList').innerHTML = list.map(f =>
    '<div class="fb-card'+(f.read?'':' unread')+'" onclick="markRead(\''+f._id+'\',this)">' +
    '<div class="fb-top"><span class="cat-pill '+f.category+'">'+(f.read?'':'<span class="dot"></span>')+cap(f.category)+'</span>' +
    '<div class="fb-meta">👤 '+esc(f.username)+'<br>🕐 '+new Date(f.createdAt).toLocaleString('it')+'</div></div>' +
    '<div class="fb-text">'+esc(f.text)+'</div></div>'
  ).join('');
}
async function markRead(id, el) {
  await fetch('/admin/feedback/'+id+'/read?key=__', { method:'POST', headers: ah() });
  el.classList.remove('unread'); const f = allFeedback.find(f=>f._id===id); if(f)f.read=true;
}
async function markAllRead() {
  for (const f of allFeedback.filter(f=>!f.read)) await markRead(f._id, {classList:{remove:()=>{}}});
  await loadFeedback();
}

// ── CONFIRM / DELETE ──────────────────────────────────────────────────────────
function deleteUser(username) {
  pendingAction = async () => {
    await fetch('/admin/users/'+encodeURIComponent(username), { method:'DELETE', headers: ah() });
    await loadUsers(); await loadDashboard();
  };
  showConfirm('Elimina Utente', 'Eliminare @'+username+' e tutti i suoi contenuti?');
}
function deletePost(id, title) {
  pendingAction = async () => {
    await fetch('/admin/posts/'+id, { method:'DELETE', headers: ah() });
    await loadPosts(); await loadDashboard();
  };
  showConfirm('Elimina Post', 'Eliminare il post "'+title+'"?');
}
function showConfirm(title, msg) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmOverlay').classList.add('show');
}
async function confirmYes() { closeConfirm(); if(pendingAction) { await pendingAction(); pendingAction=null; } }
function closeConfirm() { document.getElementById('confirmOverlay').classList.remove('show'); }

// ── UTILS ─────────────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cap(s) { return s ? s[0].toUpperCase()+s.slice(1) : ''; }

// ── INIT ──────────────────────────────────────────────────────────────────────
if (adminToken) showPanel();
</script></body></html>`);
});
app.get("/admin/feedback", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send("Accesso negato");
  res.json(await Feedback.find().sort({ createdAt: -1 }));
});

// Stesso endpoint ma con adminAuth JWT (usato dal nuovo pannello)
app.get("/admin/feedback-list", adminAuth, async (req, res) => {
  res.json(await Feedback.find().sort({ createdAt: -1 }));
});

app.post("/admin/feedback/:id/read", async (req, res) => {
  // Supporta sia la vecchia key che il nuovo adminAuth token
  const tok = req.headers["x-admin-token"];
  let ok = req.query.key === ADMIN_KEY;
  if (!ok && tok) { try { const p = jwt.verify(tok, SECRET+"_admin"); ok = p.admin; } catch {} }
  if (!ok) return res.status(403).send("Accesso negato");
  await Feedback.findByIdAndUpdate(req.params.id, { read: true });
  res.json({ ok: true });
});

app.listen(PORT, HOST, () => console.log(`SITO ATTIVO: http://${HOST}:${PORT}`));