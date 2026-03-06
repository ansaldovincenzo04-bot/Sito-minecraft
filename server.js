const express = require("express");
const fs      = require("fs");
const multer  = require("multer");
const cors    = require("cors");
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");
const path    = require("path");

const app    = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const SECRET = "hunters_universe_secret";


app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));       // serve index.html, style.css, script.js dalla root
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const dirData            = path.join(__dirname, "data");
const dirUploads         = path.join(__dirname, "uploads");
const dirDeleted         = path.join(dirUploads, "deleted");
const dirDeletedComments = path.join(dirData, "deleted_comments");
[dirData, dirUploads, dirDeleted, dirDeletedComments].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dirUploads),
  filename:    (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

const postsPath           = path.join(dirData, "posts.json");
const usersPath           = path.join(dirData, "users.json");
const friendsPath         = path.join(dirData, "friends.json");
const commentsPath        = path.join(dirData, "comments.json");
const reactionsPath       = path.join(dirData, "reactions.json");
const deletedCommentsPath = path.join(dirData, "deleted_comments", "deleted_comments.json");

function read(f)     { try { return JSON.parse(fs.readFileSync(f)); } catch { return []; } }
function write(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

function auth(req, res, next) {
  const token = req.headers.authorization;
  try { req.user = jwt.verify(token, SECRET); next(); } catch { res.status(401).send(); }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.post("/register", upload.single("profileImage"), async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).send("Compila tutti i campi obbligatori");
  const users = read(usersPath);
  if (users.find(u => u.username === username)) return res.status(400).send("Lo username esiste già");
  const hash = await bcrypt.hash(password, 10);
  users.push({ username, password: hash, profileImage: req.file ? req.file.filename : "" });
  write(usersPath, users);
  res.status(201).json({ ok: true });
});


app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(401).send("Inserisci tutti i dati");
  const users = read(usersPath);
  const user  = users.find(u => u.username === username);
  if (!user) return res.status(401).send("Username errato");
  const validPass = await bcrypt.compare(password, user.password);
  if (!validPass) return res.status(401).send("Password errata");
  const token = jwt.sign({ username: user.username }, SECRET);
  res.json({ token, username: user.username, profileImage: user.profileImage });
});

app.post("/update-profile", auth, upload.single("profileImage"), (req, res) => {
  let users = read(usersPath);
  let posts = read(postsPath);
  const idx = users.findIndex(u => u.username === req.user.username);
  if (req.file) users[idx].profileImage = req.file.filename;
  const oldN = req.user.username, newN = req.body.username;
  if (newN && newN !== oldN) {
    users[idx].username = newN;
    posts = posts.map(p => { if (p.author === oldN) p.author = newN; return p; });
    write(postsPath, posts);
    let friends = read(friendsPath);
    friends = friends.map(f => {
      if (f.from === oldN) f.from = newN;
      if (f.to   === oldN) f.to   = newN;
      return f;
    });
    write(friendsPath, friends);
    let comments = read(commentsPath);
    comments = comments.map(c => { if (c.author === oldN) c.author = newN; return c; });
    write(commentsPath, comments);
    let reactions = read(reactionsPath);
    reactions = reactions.map(r => { if (r.username === oldN) r.username = newN; return r; });
    write(reactionsPath, reactions);
  }
  write(usersPath, users);
  res.json({ token: jwt.sign({ username: users[idx].username }, SECRET), username: users[idx].username, profileImage: users[idx].profileImage });
});

// ── POSTS ─────────────────────────────────────────────────────────────────────

app.get("/posts", (req, res) => res.json(read(postsPath)));

app.post("/posts", auth, upload.single("image"), (req, res) => {
  const posts = read(postsPath);
  const post  = { id: Date.now(), author: req.user.username, title: req.body.title, image: req.file ? req.file.filename : req.body.imageUrl };
  posts.push(post); write(postsPath, posts); res.json(post);
});

app.delete("/posts/:id", auth, (req, res) => {
  const postId        = req.params.id;
  const imageFilename = req.body && req.body.image ? req.body.image : null;
  if (imageFilename && !imageFilename.startsWith("http")) {
    const filename = path.basename(imageFilename);
    const srcPath  = path.join(dirUploads, filename);
    const destPath = path.join(dirDeleted, filename);
    try { if (fs.existsSync(srcPath)) fs.renameSync(srcPath, destPath); } catch (err) { console.error(`[DELETE] ${err.message}`); }
  }
  let posts = read(postsPath);
  posts = posts.filter(p => String(p.id) !== String(postId));
  write(postsPath, posts);
  let comments = read(commentsPath);
  comments = comments.filter(c => String(c.postId) !== String(postId));
  write(commentsPath, comments);
  res.send("ok");
});

// ── COMMENTI ──────────────────────────────────────────────────────────────────

app.get("/posts/:id/comments", (req, res) => {
  const comments  = read(commentsPath);
  const users     = read(usersPath);
  const reactions = read(reactionsPath);
  const me = req.headers.authorization ? (() => { try { return jwt.verify(req.headers.authorization, SECRET).username; } catch { return null; } })() : null;
  const postComments = comments
    .filter(c => String(c.postId) === String(req.params.id))
    .map(c => {
      const u  = users.find(u => u.username === c.author);
      const cr = reactions.filter(r => String(r.commentId) === String(c.id));
      return {
        ...c,
        profileImage: u ? u.profileImage : "",
        ups:   cr.filter(r => r.reaction === "up").length,
        downs: cr.filter(r => r.reaction === "down").length,
        myReaction: me ? (cr.find(r => r.username === me) || {}).reaction || null : null
      };
    });
  res.json(postComments);
});

app.post("/posts/:id/comments", auth, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).send("Commento vuoto");
  const comments = read(commentsPath);
  const comment  = { id: Date.now(), postId: Number(req.params.id), author: req.user.username, text: text.trim(), createdAt: new Date().toISOString() };
  comments.push(comment);
  write(commentsPath, comments);
  const users = read(usersPath);
  const u     = users.find(u => u.username === comment.author);
  res.json({ ...comment, profileImage: u ? u.profileImage : "", ups: 0, downs: 0, myReaction: null });
});

app.delete("/posts/:postId/comments/:commentId", auth, (req, res) => {
  const commentId = String(req.params.commentId);
  const postId    = String(req.params.postId);
  const deletedBy = req.user.username;
  let comments    = read(commentsPath);
  const posts     = read(postsPath);
  const post      = posts.find(p => String(p.id) === postId);
  const isPostAuthor = post && post.author === deletedBy;
  const comment   = comments.find(c => String(c.id) === commentId);
  if (!comment) return res.status(404).send("Commento non trovato");
  const canDelete = comment.author === deletedBy || isPostAuthor;
  if (!canDelete) return res.status(403).send("Non autorizzato");
  const archived = read(deletedCommentsPath);
  archived.push({ ...comment, deletedAt: new Date().toISOString(), deletedBy, deletedFrom: isPostAuthor && comment.author !== deletedBy ? "post_owner" : "self", postTitle: post ? post.title : "", postAuthor: post ? post.author : "" });
  write(deletedCommentsPath, archived);
  comments = comments.filter(c => String(c.id) !== commentId);
  write(commentsPath, comments);
  res.send("ok");
});

// ── REACTIONS ─────────────────────────────────────────────────────────────────

app.post("/posts/:postId/comments/:commentId/react", auth, (req, res) => {
  const { reaction } = req.body;
  if (!["up","down"].includes(reaction)) return res.status(400).send("Reazione non valida");
  const username  = req.user.username;
  const commentId = Number(req.params.commentId);
  let reactions   = read(reactionsPath);
  const idx       = reactions.findIndex(r => r.commentId === commentId && r.username === username);
  if (idx !== -1) {
    if (reactions[idx].reaction === reaction) reactions.splice(idx, 1);
    else reactions[idx].reaction = reaction;
  } else {
    reactions.push({ commentId, username, reaction });
  }
  write(reactionsPath, reactions);
  const cr = reactions.filter(r => r.commentId === commentId);
  res.json({ ups: cr.filter(r => r.reaction === "up").length, downs: cr.filter(r => r.reaction === "down").length, myReaction: (cr.find(r => r.username === username) || {}).reaction || null });
});

// ── USERS ─────────────────────────────────────────────────────────────────────

app.get("/users/profile/:username", (req, res) => {
  const users     = read(usersPath);
  const user      = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).send("Utente non trovato");

  // Post dell'utente
  const posts     = read(postsPath);
  const userPosts = posts.filter(p => p.author === req.params.username);

  // Totale reazioni ricevute sui propri commenti
  const comments  = read(commentsPath);
  const reactions = read(reactionsPath);
  const myCommentIds = new Set(comments.filter(c => c.author === req.params.username).map(c => c.id));
  const myReactions  = reactions.filter(r => myCommentIds.has(r.commentId));
  const totalUps     = myReactions.filter(r => r.reaction === "up").length;
  const totalDowns   = myReactions.filter(r => r.reaction === "down").length;

  res.json({
    username: user.username,
    profileImage: user.profileImage,
    posts: userPosts,
    totalUps,
    totalDowns
  });
});

app.get("/users/search", auth, (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).send("Username mancante");
  const users = read(usersPath);
  const found = users.find(u => u.username === username && u.username !== req.user.username);
  if (!found) return res.status(404).send("Utente non trovato");
  res.json({ username: found.username, profileImage: found.profileImage });
});

// ── FRIENDS ───────────────────────────────────────────────────────────────────

app.get("/friends/data", auth, (req, res) => {
  const me      = req.user.username;
  const friends = read(friendsPath);
  const result  = { friends: [], pendingSent: [], pendingReceived: [] };
  friends.forEach(f => {
    if (f.status === "accepted" && (f.from === me || f.to === me))
      result.friends.push(f.from === me ? f.to : f.from);
    else if (f.status === "pending") {
      if (f.from === me) result.pendingSent.push(f.to);
      if (f.to   === me) result.pendingReceived.push(f.from);
    }
  });
  res.json(result);
});

app.delete("/friends/:username", auth, (req, res) => {
  const me    = req.user.username;
  const other = req.params.username;
  let friends = read(friendsPath);
  friends = friends.filter(f =>
    !((f.from === me && f.to === other) || (f.from === other && f.to === me))
  );
  write(friendsPath, friends);
  res.json({ ok: true });
});

app.post("/friends/request", auth, (req, res) => {
  const from = req.user.username, { to } = req.body;
  if (!to || to === from) return res.status(400).send("Destinatario non valido");
  const users = read(usersPath);
  if (!users.find(u => u.username === to)) return res.status(404).send("Utente non trovato");
  const friends = read(friendsPath);
  const exists  = friends.find(f => (f.from === from && f.to === to) || (f.from === to && f.to === from));
  if (exists) return res.status(409).send("Richiesta già esistente o già amici");
  friends.push({ from, to, status: "pending" });
  write(friendsPath, friends);
  res.json({ ok: true });
});

app.post("/friends/accept", auth, (req, res) => {
  const me = req.user.username, { from } = req.body;
  const friends = read(friendsPath);
  const idx = friends.findIndex(f => f.from === from && f.to === me && f.status === "pending");
  if (idx === -1) return res.status(404).send("Richiesta non trovata");
  friends[idx].status = "accepted";
  write(friendsPath, friends);
  res.json({ ok: true });
});

app.post("/friends/reject", auth, (req, res) => {
  const me = req.user.username, { from } = req.body;
  let friends = read(friendsPath);
  friends = friends.filter(f => !(f.from === from && f.to === me && f.status === "pending"));
  write(friendsPath, friends);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, HOST, () => console.log(`SITO ATTIVO: http://${HOST}:${PORT}`));