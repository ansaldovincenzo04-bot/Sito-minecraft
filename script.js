// ── STRINGHE BASE (Italiano) ──────────────────────────────────────────────────
const BASE_STRINGS = {
    // Sidebar sinistra
    profile:    "Profilo",
    yourImgs:   "Le tue immagini:",
    create:     "Crea Post",
    delete:     "Modalità Elimina",
    confirm:    "Conferma Elimina",
    // Menu utente
    logout:     "Esci",
    editProfile:"Modifica Profilo",
    editTitle:  "Modifica Profilo",
    langLabel:  "Lingue",
    // Auth
    login:      "Entra",
    register:   "Registrati",
    switchReg:  "Non hai un account? Registrati",
    switchLog:  "Hai un account? Accedi",
    logoutTitle:"Sei sicuro?",
    yesLogout:  "Sì, Esci",
    regDone:    "Registrazione completata! Ora accedi.",
    // Amici sidebar
    friends:    "Amici",
    searchPlaceholder: "Cerca username...",
    searchBtn:  "Cerca",
    noFriends:  "Nessun amico ancora",
    reqSent:    "Richiesta inviata",
    reqWaiting: "In attesa di risposta",
    reqWants:   "Vuole essere tuo amico",
    accept:     "Accetta",
    reject:     "Rifiuta",
    // Popover amico
    viewProfile:      "👤 Vedi Profilo",
    removeFriend:     "💔 Rimuovi Amico",
    removeFriendTitle:"Rimuovi Amico",
    removeFriendDesc: "Sei sicuro di voler rimuovere",
    removeFriendDesc2:"dagli amici?",
    confirmRemoveYes: "Sì, Rimuovi",
    // Pannello profilo utente
    postsPublished:   "Post pubblicati",
    noPosts:          "Nessun post ancora.",
    // Post feed
    by:               "Di",
    // Creazione post
    newPost:    "Nuovo Post",
    titlePlaceholder: "Titolo...",
    urlPlaceholder:   "URL o Nome File...",
    publish:    "Pubblica",
    cancel:     "Annulla",
    saveProfile:"Salva Modifiche",
    newUsername:"Nuovo Username",
    insertTitle:"Inserisci un titolo",
    // Alert
    warning:    "Attenzione",
    ok:         "OK",
    // Errori amici
    alreadyFriend:    "è già tuo amico!",
    alreadySent:      "Hai già inviato una richiesta a",
    alreadyReceived:  "ti ha già inviato una richiesta!",
    // Commenti
    comments:         "Commenti",
    noComments:       "Nessun commento ancora. Sii il primo!",
    commentPlaceholder: "Scrivi un commento...",
    commentPublish:   "Pubblica",
    commentLoginMsg:  "Accedi per commentare",
    sortRecent:       "Recenti",
    sortPopular:      "Popolari",
    badgeOp:          "OP",
    badgeFriend:      "👥 Amico",
    // Tempo relativo
    justNow:          "Adesso",
    minutesAgo:       "min fa",
    hoursAgo:         "ore fa",
    // Mobile nav
    mobileProfile:    "Profilo",
    mobileFeed:       "Home",
    mobileFriends:    "Amici",
};

const LANGUAGES = [
    { code: "it", label: "Italiano",   flag: "🇮🇹" },
    { code: "en", label: "English",    flag: "🇬🇧" },
    { code: "es", label: "Español",    flag: "🇪🇸" },
    { code: "fr", label: "Français",   flag: "🇫🇷" },
    { code: "de", label: "Deutsch",    flag: "🇩🇪" },
    { code: "pt", label: "Português",  flag: "🇵🇹" },
    { code: "ru", label: "Русский",    flag: "🇷🇺" },
    { code: "zh", label: "中文",        flag: "🇨🇳" },
    { code: "ja", label: "日本語",      flag: "🇯🇵" },
    { code: "ar", label: "العربية",    flag: "🇸🇦" },
    { code: "hi", label: "हिन्दी",     flag: "🇮🇳" },
    { code: "ko", label: "한국어",      flag: "🇰🇷" },
    { code: "tr", label: "Türkçe",     flag: "🇹🇷" },
    { code: "pl", label: "Polski",     flag: "🇵🇱" },
    { code: "nl", label: "Nederlands", flag: "🇳🇱" },
];

// ── TRADUTTORE ────────────────────────────────────────────────────────────────
let t = { ...BASE_STRINGS };

// Versione cache — incrementa ogni volta che aggiungi stringhe a BASE_STRINGS
const STRINGS_VERSION = "v4";

async function translateAll(langCode) {
    if (langCode === "it") return { ...BASE_STRINGS };
    const cacheKey = `lang_cache_${langCode}_${STRINGS_VERSION}`;

    // Invalida cache versioni vecchie
    Object.keys(localStorage)
        .filter(k => k.startsWith(`lang_cache_${langCode}`) && k !== cacheKey)
        .forEach(k => localStorage.removeItem(k));

    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            // Verifica che tutte le chiavi esistano (doppia sicurezza)
            const allPresent = Object.keys(BASE_STRINGS).every(k => parsed[k] !== undefined);
            if (allPresent) return parsed;
            // Chiavi mancanti → rigenera
            localStorage.removeItem(cacheKey);
        } catch {}
    }
    const keys = Object.keys(BASE_STRINGS), values = Object.values(BASE_STRINGS);
    const joined = values.join("\n||||\n");
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=it&tl=${langCode}&dt=t&q=${encodeURIComponent(joined)}`;
    try {
        const res = await fetch(url); const data = await res.json();
        const translated = data[0].map(chunk => chunk[0]).join("").split("\n||||\n");
        const result = {};
        keys.forEach((k, i) => { result[k] = (translated[i] || values[i]).trim(); });
        localStorage.setItem(cacheKey, JSON.stringify(result));
        return result;
    } catch (e) { return { ...BASE_STRINGS }; }
}

// ── STATO ─────────────────────────────────────────────────────────────────────
let currentLang   = localStorage.getItem("lang") || "it";
let token         = localStorage.getItem("token");
let currentUser   = JSON.parse(localStorage.getItem("user")) || null;
let isLoginMode   = true;
let deleteMode    = false;
let selectedPosts = new Map();
let prevFriendsState = null;
let pollingInterval  = null;
let currentOpenPostId     = null;
let currentOpenPostAuthor = null;
let myFriends             = new Set(); // username degli amici dell'utente loggato
let currentSort           = 'recent'; // 'recent' | 'popular'
let profilePanelUser      = null;   // username del profilo aperto
let panelStack            = [];     // ['profile', 'comments'] per navigazione
let commentsPollingInterval = null;
const DEFAULT_PFP = "/uploads/default-avatar.png";

// Gestisce sia URL Cloudinary (https://...) che vecchi path locali (/uploads/...)
function imgUrl(src) {
    if (!src) return DEFAULT_PFP;
    if (src.startsWith("http")) return src;
    return `/uploads/${src}`;
}

function showAlert(msg) {
    document.getElementById("alertMessage").innerText = msg;
    document.getElementById("alertModal").classList.remove("hidden");
}

// ── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
    // Se abbiamo un token salvato, verifichiamo che il server lo riconosca ancora
    // (es. dopo un riavvio del server su Render free tier)
    if (token) {
        try {
            const res = await fetch("/auth/verify", { headers: { "Authorization": token } });
            if (!res.ok) {
                // Token non più valido — puliamo e mostriamo login
                localStorage.removeItem("token");
                localStorage.removeItem("user");
                token       = null;
                currentUser = null;
            } else {
                // Aggiorna i dati utente freschi dal server
                const fresh = await res.json();
                currentUser = { ...currentUser, ...fresh };
                localStorage.setItem("user", JSON.stringify(currentUser));
            }
        } catch {
            // Server non raggiungibile — manteniamo lo stato locale
        }
    }
    t = await translateAll(currentLang);
    applyStaticTranslations();
    updateUI();
    loadPosts();
}

function applyStaticTranslations() {
    document.getElementById("alertOkBtn").innerText        = t.ok;
    document.getElementById("alertTitle").innerText        = t.warning;
    document.getElementById("createPostTitle").innerText   = t.newPost;
    document.getElementById("postTitle").placeholder       = t.titlePlaceholder;
    document.getElementById("postImageUrl").placeholder    = t.urlPlaceholder;
    document.getElementById("submitPost").innerText        = t.publish;
    document.getElementById("cancelCreate").innerText      = t.cancel;
    document.getElementById("submitEditProfile").innerText = t.saveProfile;
    document.getElementById("editUsernameInput").placeholder = t.newUsername;
    document.getElementById("cancelEdit").innerText        = t.cancel;
    document.getElementById("friendsHeader").innerText     = t.friends;
    document.getElementById("friendSearchInput").placeholder = t.searchPlaceholder;
    document.getElementById("friendSearchBtn").innerText   = t.searchBtn;
    document.getElementById("commentsTitle").innerText     = t.comments;
    document.getElementById("commentText").placeholder     = t.commentPlaceholder;
    document.getElementById("submitComment").innerText     = t.commentPublish;
    document.getElementById("commentLoginMsg").innerText   = t.commentLoginMsg;
    document.getElementById("sortRecent").innerText         = t.sortRecent;
    document.getElementById("sortPopular").innerText        = t.sortPopular;
    document.getElementById("label-edit-title").innerText   = t.editTitle;
    document.getElementById("popoverViewProfile").innerText = t.viewProfile;
    document.getElementById("popoverRemoveFriend").innerText= t.removeFriend;
    document.getElementById("confirmRemoveTitle").innerText = t.removeFriendTitle;
    document.getElementById("confirmRemoveYes").innerText   = t.confirmRemoveYes;
    document.getElementById("cancelRemoveNo")?.setAttribute("innerText", t.cancel);
    const postsLbl = document.getElementById("profilePostsLabel");
    if (postsLbl) postsLbl.innerText = t.postsPublished;
    // Mobile nav labels
    const mnlP = document.getElementById("mobileNavLabelProfile");
    const mnlF = document.getElementById("mobileNavLabelFeed");
    const mnlA = document.getElementById("mobileNavLabelFriends");
    if (mnlP) mnlP.innerText = t.mobileProfile;
    if (mnlF) mnlF.innerText = t.mobileFeed;
    if (mnlA) mnlA.innerText = t.mobileFriends;
}

// ── UI ────────────────────────────────────────────────────────────────────────
function buildLangList() {
    return LANGUAGES.map(l =>
        `<div onclick="setLang('${l.code}')" class="${l.code === currentLang ? 'lang-active' : ''}">
            ${l.flag} ${l.label}
        </div>`
    ).join("");
}

function updateUI() {
    const authArea     = document.getElementById("authArea");
    const rightSidebar = document.querySelector(".right");
    document.getElementById("label-profile").innerText      = t.profile;
    document.getElementById("label-your-imgs").innerText    = t.yourImgs;
    document.getElementById("openCreate").innerText         = t.create;
    if (!deleteMode) document.getElementById("deleteModeBtn").innerText = t.delete;
    document.getElementById("logoutConfirmTitle").innerText = t.logoutTitle;
    document.getElementById("yesLogoutBtn").innerText       = t.yesLogout;
    document.getElementById("cancelLogout").innerText       = t.cancel;

    if (!token) {
        authArea.innerHTML = `<button onclick="openLogin()" class="btn-main" style="width:auto; padding:0 20px">${t.login}</button>`;
        rightSidebar.classList.add("locked");
        stopPolling();
        document.getElementById("commentInputArea").classList.add("hidden");
        document.getElementById("commentLoginMsg").classList.remove("hidden");
    } else {
        const pfp = (currentUser && currentUser.profileImage) ? imgUrl(currentUser.profileImage) : DEFAULT_PFP;
        const currentLangObj = LANGUAGES.find(l => l.code === currentLang) || LANGUAGES[0];
        authArea.innerHTML = `
            <div class="user-profile-nav" onclick="toggleMenu('logoutMenu')">
                <img src="${pfp}" onerror="this.src='${DEFAULT_PFP}'">
                <span>${currentUser.username}</span>
                <div id="logoutMenu" class="logout-confirm hidden" onclick="event.stopPropagation()">
                    <button onclick="openEditProfile()" class="btn-main" style="margin-bottom:10px">${t.editProfile}</button>
                    <div class="lang-dropdown-container">
                        <button class="btn-secondary" onclick="toggleMenu('langList')">
                            ${currentLangObj.flag} ${currentLangObj.label} ▼
                        </button>
                        <div id="langList" class="lang-list hidden">${buildLangList()}</div>
                    </div>
                    <button onclick="openLogoutConfirm()" class="btn-secondary" style="background:#ff4747; color:white; margin-top:10px">${t.logout}</button>
                </div>
            </div>`;
        rightSidebar.classList.remove("locked");
        document.getElementById("commentInputArea").classList.remove("hidden");
        document.getElementById("commentLoginMsg").classList.add("hidden");
        document.getElementById("commentMeAvatar").src = imgUrl(currentUser.profileImage);
        loadMyPosts();
        loadFriendsData();
        startPolling();
    }
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function openLogin() {
    isLoginMode = true;
    document.getElementById("authModal").classList.remove("hidden");
    updateAuthModal();
}
function updateAuthModal() {
    document.getElementById("authTitle").innerText  = isLoginMode ? t.login : t.register;
    document.getElementById("authSubmit").innerText = isLoginMode ? t.login : t.register;
    document.getElementById("authSwitch").innerText = isLoginMode ? t.switchReg : t.switchLog;
    document.getElementById("cancelAuth").innerText = t.cancel;
    document.getElementById("registerPfpContainer").classList.toggle("hidden", isLoginMode);
}
document.getElementById("authSwitch").onclick = () => { isLoginMode = !isLoginMode; updateAuthModal(); };
document.getElementById("authSubmit").onclick = async () => {
    const username = document.getElementById("authUsername").value;
    const password = document.getElementById("authPassword").value;
    const url = isLoginMode ? "/login" : "/register";
    let body, headers = {};
    if (isLoginMode) {
        body = JSON.stringify({ username, password });
        headers["Content-Type"] = "application/json";
    } else {
        body = new FormData();
        body.append("username", username);
        body.append("password", password);
        const pfp = document.getElementById("registerPfpFile").files[0];
        if (pfp) body.append("profileImage", pfp);
    }
    const res = await fetch(url, { method: "POST", headers, body });
    if (res.ok) {
        if (isLoginMode) {
            const data = await res.json();
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data));
            location.reload();
        } else {
            showAlert(t.regDone);
            isLoginMode = true;
            updateAuthModal();
        }
    } else { showAlert(await res.text() || "Errore"); }
};
function openEditProfile() {
    document.getElementById("logoutMenu").classList.add("hidden");
    if (currentUser) {
        document.getElementById("editUsernameInput").value = currentUser.username;
        document.getElementById("editPfpPreview").src = imgUrl(currentUser.profileImage);
    }
    document.getElementById("editProfileModal").classList.remove("hidden");
}
document.getElementById("submitEditProfile").onclick = async () => {
    const fd = new FormData();
    fd.append("username", document.getElementById("editUsernameInput").value);
    const file = document.getElementById("editPfpFile").files[0];
    if (file) fd.append("profileImage", file);
    const res = await fetch("/update-profile", { method: "POST", headers: { "Authorization": token }, body: fd });
    if (res.ok) { const data = await res.json(); localStorage.setItem("user", JSON.stringify(data)); localStorage.setItem("token", data.token); location.reload(); }
};

// ── POSTS ─────────────────────────────────────────────────────────────────────
document.getElementById("submitPost").onclick = async () => {
    const title = document.getElementById("postTitle").value;
    const file  = document.getElementById("postImageFile").files[0];
    const url   = document.getElementById("postImageUrl").value;
    if (!title) return showAlert(t.insertTitle);
    const fd = new FormData();
    fd.append("title", title);
    if (file) fd.append("image", file); else fd.append("imageUrl", url);
    const res = await fetch("/posts", { method: "POST", headers: { "Authorization": token }, body: fd });
    if (res.ok) location.reload();
};

document.addEventListener('change', (e) => {
    if (e.target.id === 'postImageFile' && e.target.files[0])
        document.getElementById("postImageUrl").value = ""; // pulisce l'URL quando si sceglie un file
    if ((e.target.id === 'registerPfpFile' || e.target.id === 'editPfpFile') && e.target.files[0]) {
        const reader = new FileReader();
        const prevId = e.target.id === 'registerPfpFile' ? "registerPfpPreview" : "editPfpPreview";
        reader.onload = (ex) => document.getElementById(prevId).src = ex.target.result;
        reader.readAsDataURL(e.target.files[0]);
    }
});

async function loadPosts() {
    const res   = await fetch("/posts");
    const posts = await res.json();
    const container = document.getElementById("posts");
    container.innerHTML = "";
    const allComments = await fetch("/posts").then(() => null).catch(() => null); // prefetch skip
    for (const post of posts.reverse()) {
        // Conta commenti (fetch leggera)
        let commentCount = 0;
        try {
            const cr = await fetch(`/posts/${post.id}/comments`);
            const cs = await cr.json();
            commentCount = cs.length;
        } catch {}

        const div = document.createElement("div");
        div.className = "post";
        const imgSrc = imgUrl(post.image);
        div.innerHTML = `
            <h3>${post.title}</h3>
            <small>${t.by} ${post.author}</small>
            <img src="${imgSrc}" onerror="this.src='${DEFAULT_PFP}'" data-post-id="${post.id}">
            <div class="post-comment-count" data-post-id="${post.id}">💬 ${commentCount} ${t.comments}</div>`;
        div.querySelector("img").onclick = () => openPostDetail(post);
        div.querySelector(".post-comment-count").onclick = () => openPostDetail(post);
        container.appendChild(div);
    }
}

async function loadMyPosts() {
    const res = await fetch("/posts"); const posts = await res.json();
    const container = document.getElementById("myPosts"); container.innerHTML = "";
    posts.filter(p => p.author === (currentUser ? currentUser.username : "")).forEach(post => {
        const img = document.createElement("img");
        img.src = imgUrl(post.image);
        img.className = "mini-post" + (selectedPosts.has(post.id) ? " selectedDelete" : "");
        img.onclick = () => {
            if (deleteMode) {
                img.classList.toggle("selectedDelete");
                if (selectedPosts.has(post.id)) selectedPosts.delete(post.id);
                else selectedPosts.set(post.id, post.image);
            } else {
                openPostDetail(post);
            }
        };
        container.appendChild(img);
    });
}

// ── POST DETAIL & COMMENTI ────────────────────────────────────────────────────

async function openPostDetail(post) {
    currentOpenPostId     = post.id;
    currentOpenPostAuthor = post.author;
    const imgSrc = imgUrl(post.image);

    document.getElementById("detailPostTitle").innerText = post.title || "";
    document.getElementById("detailPostImage").src = imgSrc;
    document.getElementById("detailAuthorName").innerText = post.author || "";
    document.getElementById("detailPostDate").innerText = post.id ? formatDate(post.id) : "";

    // Avatar autore — endpoint pubblico, funziona anche senza login e anche sul proprio profilo
    try {
        const ur = await fetch(`/users/profile/${encodeURIComponent(post.author)}`);
        if (ur.ok) {
            const u = await ur.json();
            document.getElementById("detailAuthorAvatar").src = imgUrl(u.profileImage);
        } else { document.getElementById("detailAuthorAvatar").src = DEFAULT_PFP; }
    } catch { document.getElementById("detailAuthorAvatar").src = DEFAULT_PFP; }

    document.getElementById("postDetail").classList.remove("hidden");
    await loadComments(post.id);
    startCommentsPolling();
}

function setSort(mode) {
    if (mode === currentSort) return;
    currentSort = mode;
    document.getElementById("sortRecent").classList.toggle("active",  mode === "recent");
    document.getElementById("sortPopular").classList.toggle("active", mode === "popular");
    if (currentOpenPostId) loadComments(currentOpenPostId);
}

function closePostDetail() {
    document.getElementById("postDetail").classList.add("hidden");
    currentOpenPostId = null;
    currentOpenPostAuthor = null;
    stopCommentsPolling();
}

document.getElementById("postDetailClose").onclick = closePostDetail;

// Chiudi premendo Escape
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentOpenPostId !== null) closePostDetail();
});

function sortComments(comments) {
    if (currentSort === 'popular') {
        return [...comments].sort((a, b) => ((b.ups||0) - (b.downs||0)) - ((a.ups||0) - (a.downs||0)));
    }
    // recent: ordina per createdAt decrescente
    return [...comments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function loadComments(postId, silent = false) {
    const res      = await fetch(`/posts/${postId}/comments`, {
        headers: token ? { "Authorization": token } : {}
    });
    const comments = await res.json();
    const list     = document.getElementById("commentsList");

    // Se silent, salva la posizione scroll e non resettare se i commenti non sono cambiati
    const prevCount = list.querySelectorAll(".comment-item").length;
    const sorted    = sortComments(comments);

    // Ricostruisci sempre (semplice e affidabile)
    const prevScrollTop = list.scrollTop;
    list.innerHTML = "";

    if (sorted.length === 0) {
        list.innerHTML = `<div class="no-comments">${t.noComments}</div>`;
        return;
    }

    sorted.forEach(c => appendComment(c, false)); // false = non fare scroll automatico

    // Scroll: se silent mantieni posizione, altrimenti vai in fondo
    if (silent) {
        list.scrollTop = prevScrollTop;
    } else {
        list.scrollTop = list.scrollHeight;
    }
}

function appendComment(c, doScroll = true) {
    const list   = document.getElementById("commentsList");
    const noMsg  = list.querySelector(".no-comments");
    if (noMsg) noMsg.remove();

    // Può eliminare: autore del commento OPPURE autore del post
    const canDelete = currentUser && (c.author === currentUser.username || currentOpenPostAuthor === currentUser.username);
    const pfp       = imgUrl(c.profileImage);
    const ups       = c.ups   || 0;
    const downs     = c.downs || 0;
    const myReaction = c.myReaction || null;

    const div = document.createElement("div");
    div.className = "comment-item";
    div.dataset.commentId = c.id;
    div.innerHTML = `
        <img class="comment-avatar" src="${pfp}" onerror="this.src='${DEFAULT_PFP}'">
        <div class="comment-body">
            ${canDelete ? `<button class="comment-delete-btn" title="Elimina">✕</button>` : ""}
            <div class="comment-username-row">
                <span class="comment-username">${c.author || "Utente"}</span>
                ${c.author === currentOpenPostAuthor ? `<span class="badge badge-op">${t.badgeOp}</span>` : ""}
                ${currentUser && c.author !== currentUser.username && myFriends.has(c.author) ? `<span class="badge badge-friend">${t.badgeFriend}</span>` : ""}
            </div>
            <div class="comment-text">${escapeHtml(c.text || "")}</div>
            <div class="comment-time">${formatRelTime(c.createdAt)}</div>
            <div class="comment-reactions">
                <button class="reaction-btn reaction-up ${myReaction === 'up' ? 'active-up' : ''}" data-reaction="up">
                    👍 <span class="reaction-count">${ups > 0 ? ups : ""}</span>
                </button>
                <button class="reaction-btn reaction-down ${myReaction === 'down' ? 'active-down' : ''}" data-reaction="down">
                    👎 <span class="reaction-count">${downs > 0 ? downs : ""}</span>
                </button>
            </div>
        </div>`;

    if (canDelete) {
        div.querySelector(".comment-delete-btn").onclick = async () => {
            await fetch(`/posts/${currentOpenPostId}/comments/${c.id}`, { method: "DELETE", headers: { "Authorization": token } });
            div.remove();
            if (list.querySelectorAll(".comment-item").length === 0)
                list.innerHTML = `<div class="no-comments">${t.noComments}</div>`;
            updateCommentCounter();
        };
    }

    // Reactions
    div.querySelectorAll(".reaction-btn").forEach(btn => {
        btn.onclick = async () => {
            if (!token) return;
            const reaction = btn.dataset.reaction;
            const res = await fetch(`/posts/${currentOpenPostId}/comments/${c.id}/react`, {
                method: "POST",
                headers: { "Authorization": token, "Content-Type": "application/json" },
                body: JSON.stringify({ reaction })
            });
            if (res.ok) {
                const data = await res.json();
                const upBtn   = div.querySelector(".reaction-up");
                const downBtn = div.querySelector(".reaction-down");
                upBtn.querySelector(".reaction-count").textContent   = data.ups   > 0 ? data.ups   : "";
                downBtn.querySelector(".reaction-count").textContent = data.downs > 0 ? data.downs : "";
                upBtn.classList.toggle("active-up",     data.myReaction === "up");
                downBtn.classList.toggle("active-down", data.myReaction === "down");
            }
        };
    });

    list.appendChild(div);
    if (doScroll) list.scrollTop = list.scrollHeight;
}

function updateCommentCounter() {
    if (!currentOpenPostId) return;
    const n       = document.querySelectorAll(".comment-item").length;
    const counter = document.querySelector(`.post-comment-count[data-post-id="${currentOpenPostId}"]`);
    if (counter) counter.innerHTML = `💬 ${n} ${t.comments}`;
}

document.getElementById("submitComment").onclick = async () => {
    const textarea = document.getElementById("commentText");
    const text     = textarea.value.trim();
    if (!text || !currentOpenPostId) return;

    const res = await fetch(`/posts/${currentOpenPostId}/comments`, {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    if (res.ok) {
        textarea.value = "";
        textarea.style.height = "auto";
        await loadComments(currentOpenPostId);
        updateCommentCounter();
    }
};

// Pubblica anche con Ctrl+Invio
document.getElementById("commentText").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) document.getElementById("submitComment").click();
});

// ── FRIENDS ───────────────────────────────────────────────────────────────────
async function loadFriendsData() {
    if (!token) return;
    const res = await fetch("/friends/data", { headers: { "Authorization": token } });
    if (!res.ok) return;
    const data = await res.json();
    const stateKey = JSON.stringify(data);
    if (stateKey === prevFriendsState) return;
    prevFriendsState = stateKey;
    myFriends = new Set(data.friends); // aggiorna sempre
    renderFriendsList(data.friends);
    renderFriendRequests(data.pendingSent, data.pendingReceived);
}

function renderFriendsList(friends) {
    const container = document.getElementById("friendsList");
    container.innerHTML = "";
    if (friends.length === 0) { container.innerHTML = `<p style="color:#555; font-size:13px; text-align:center; margin-top:10px;">${t.noFriends}</p>`; return; }
    friends.forEach(username => {
        const div = document.createElement("div"); div.className = "friend-item";
        div.style.cursor = "pointer";
        div.innerHTML = `<img src="${DEFAULT_PFP}" onerror="this.src='${DEFAULT_PFP}'"><span>${username}</span>`;
        // Carica avatar reale
        fetch(`/users/profile/${encodeURIComponent(username)}`).then(r => r.ok ? r.json() : null).then(u => {
            if (u && u.profileImage) div.querySelector("img").src = imgUrl(u.profileImage);
        });
        div.onclick = (e) => showFriendPopover(e, username);
        container.appendChild(div);
    });
}

function renderFriendRequests(pendingSent, pendingReceived) {
    const container = document.getElementById("friendRequests"); container.innerHTML = "";
    pendingSent.forEach(username => {
        const box = document.createElement("div"); box.className = "friend-request-box sent";
        box.innerHTML = `
            <div class="req-header">
                <img class="req-avatar" src="${DEFAULT_PFP}" onerror="this.src='${DEFAULT_PFP}'">
                <div class="req-info"><div class="req-username">${username}</div><div class="req-sublabel">${t.reqSent}</div></div>
            </div>
            <div class="req-pending-badge"><span class="req-pending-dot"></span>${t.reqWaiting}</div>`;
        container.appendChild(box);
    });
    pendingReceived.forEach(username => {
        const box = document.createElement("div"); box.className = "friend-request-box received";
        box.innerHTML = `
            <div class="req-header">
                <img class="req-avatar" src="${DEFAULT_PFP}" onerror="this.src='${DEFAULT_PFP}'">
                <div class="req-info"><div class="req-username">${username}</div><div class="req-sublabel">${t.reqWants}</div></div>
            </div>
            <div class="req-actions">
                <button class="req-btn accept">✔ ${t.accept}</button>
                <button class="req-btn reject">✖ ${t.reject}</button>
            </div>`;
        box.querySelector(".req-btn.accept").onclick = async () => {
            await fetch("/friends/accept", { method: "POST", headers: { "Authorization": token, "Content-Type": "application/json" }, body: JSON.stringify({ from: username }) });
            prevFriendsState = null; loadFriendsData();
        };
        box.querySelector(".req-btn.reject").onclick = async () => {
            await fetch("/friends/reject", { method: "POST", headers: { "Authorization": token, "Content-Type": "application/json" }, body: JSON.stringify({ from: username }) });
            prevFriendsState = null; loadFriendsData();
        };
        container.appendChild(box);
    });
}

function startPolling() { if (pollingInterval) return; pollingInterval = setInterval(() => { if (token) loadFriendsData(); }, 4000); }
function stopPolling()  { if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; } }

function startCommentsPolling() {
    if (commentsPollingInterval) return;
    commentsPollingInterval = setInterval(async () => {
        if (currentOpenPostId) await loadComments(currentOpenPostId, true);
    }, 8000);
}
function stopCommentsPolling() {
    if (commentsPollingInterval) { clearInterval(commentsPollingInterval); commentsPollingInterval = null; }
}

// ── RICERCA AMICO ─────────────────────────────────────────────────────────────
document.getElementById("friendSearchBtn").onclick = async () => {
    const input = document.getElementById("friendSearchInput"); const username = input.value.trim(); if (!username) return;
    const res = await fetch(`/users/search?username=${encodeURIComponent(username)}`, { headers: { "Authorization": token } });
    if (!res.ok) {
        input.classList.remove("input-flash-error"); void input.offsetWidth; input.classList.add("input-flash-error");
        input.addEventListener("animationend", () => input.classList.remove("input-flash-error"), { once: true }); return;
    }
    const user = await res.json();
    const dataRes = await fetch("/friends/data", { headers: { "Authorization": token } }); const data = await dataRes.json();
    if (data.friends.includes(user.username))        { showAlert(`${user.username} ${t.alreadyFriend}`); return; }
    if (data.pendingSent.includes(user.username))     { showAlert(`${t.alreadySent} ${user.username}.`); return; }
    if (data.pendingReceived.includes(user.username)) { showAlert(`${user.username} ${t.alreadyReceived}`); return; }
    const reqRes = await fetch("/friends/request", { method: "POST", headers: { "Authorization": token, "Content-Type": "application/json" }, body: JSON.stringify({ to: user.username }) });
    if (reqRes.ok) { input.value = ""; prevFriendsState = null; loadFriendsData(); }
    else showAlert(await reqRes.text());
};
document.getElementById("friendSearchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("friendSearchBtn").click(); });

// ── UTILS ─────────────────────────────────────────────────────────────────────
function toggleMenu(id) { document.getElementById(id).classList.toggle("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }
function setLang(l)     { localStorage.setItem("lang", l); location.reload(); }
function openLogoutConfirm() { document.getElementById("logoutMenu").classList.add("hidden"); document.getElementById("logoutConfirmModal").classList.remove("hidden"); }
function confirmLogout() { localStorage.clear(); location.reload(); }

function escapeHtml(text) {
    return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function formatDate(id) {
    const d = new Date(id);
    return d.toLocaleDateString(currentLang, { day: "numeric", month: "long", year: "numeric" });
}
function formatRelTime(iso) {
    if (!iso) return t.justNow;
    const diff = (Date.now() - new Date(iso)) / 1000;
    if (diff < 60)   return t.justNow;
    if (diff < 3600) return `${Math.floor(diff/60)} ${t.minutesAgo}`;
    if (diff < 86400)return `${Math.floor(diff/3600)} ${t.hoursAgo}`;
    return new Date(iso).toLocaleDateString(currentLang, { day: "numeric", month: "short" });
}

document.getElementById("openCreate").onclick    = () => document.getElementById("createModal").classList.remove("hidden");
document.getElementById("deleteModeBtn").onclick = async function () {
    if (!deleteMode) {
        deleteMode = true;
        this.classList.add("active-delete");
        this.innerText = t.confirm;
        updateUI();
    } else {
        for (let [id, image] of selectedPosts)
            await fetch(`/posts/${id}`, { method: "DELETE", headers: { "Authorization": token, "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
        location.reload();
    }
};

// ── FRIEND POPOVER ───────────────────────────────────────────────────────────

let popoverTarget = null;

function showFriendPopover(e, username) {
    e.stopPropagation();
    popoverTarget = username;
    const popover = document.getElementById("friendPopover");
    popover.classList.remove("hidden");
    // Posiziona vicino al click
    const x = Math.min(e.clientX, window.innerWidth  - 185);
    const y = Math.min(e.clientY, window.innerHeight - 110);
    popover.style.left = x + "px";
    popover.style.top  = y + "px";
}

function hideFriendPopover() {
    document.getElementById("friendPopover").classList.add("hidden");
    popoverTarget = null;
}

document.addEventListener("click", (e) => {
    if (!document.getElementById("friendPopover").contains(e.target))
        hideFriendPopover();
});

document.getElementById("popoverViewProfile").onclick = () => {
    const username = popoverTarget;
    hideFriendPopover();
    openUserProfile(username);
};

document.getElementById("popoverRemoveFriend").onclick = () => {
    const username = popoverTarget;
    hideFriendPopover();
    document.getElementById("confirmRemoveDesc").innerText = `${t.removeFriendDesc} ${username} ${t.removeFriendDesc2}`;
    document.getElementById("confirmRemoveModal").classList.remove("hidden");
    document.getElementById("confirmRemoveYes").onclick = async () => {
        await fetch(`/friends/${encodeURIComponent(username)}`, {
            method: "DELETE",
            headers: { "Authorization": token }
        });
        myFriends.delete(username);
        prevFriendsState = null;
        closeModal("confirmRemoveModal");
        loadFriendsData();
    };
};

// ── USER PROFILE PANEL ────────────────────────────────────────────────────────

async function openUserProfile(username) {
    profilePanelUser = username;
    panelStack = ["profile"];

    const res  = await fetch(`/users/profile/${encodeURIComponent(username)}`);
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById("profilePanelAvatar").src =
        imgUrl(data.profileImage);
    document.getElementById("profilePanelUsername").innerText = data.username;
    document.getElementById("profileTotalUps").innerText      = data.totalUps   || 0;
    document.getElementById("profileTotalDowns").innerText    = data.totalDowns || 0;

    // Griglia post
    const grid = document.getElementById("profilePanelPosts");
    grid.innerHTML = "";
    if (!data.posts || data.posts.length === 0) {
        grid.innerHTML = `<p style="color:#555; font-size:13px;">${t.noPosts}</p>`;
    } else {
        data.posts.forEach(post => {
            const img = document.createElement("img");
            img.className = "profile-post-thumb";
            img.src = imgUrl(post.image);
            img.onerror = () => img.src = DEFAULT_PFP;
            img.onclick = () => {
                // Nascondi profilo, apri commenti, ricorda stack
                document.getElementById("userProfilePanel").classList.add("hidden");
                panelStack.push("comments");
                openPostDetail(post);
            };
            grid.appendChild(img);
        });
    }

    // Sposta il pannello dentro main (stesso layer di postDetail)
    document.querySelector("main").appendChild(document.getElementById("userProfilePanel"));
    document.getElementById("userProfilePanel").classList.remove("hidden");
    document.getElementById("postDetail").classList.add("hidden");
}

document.getElementById("profilePanelClose").onclick = () => {
    document.getElementById("userProfilePanel").classList.add("hidden");
    profilePanelUser = null;
    panelStack = [];
};

// Override closePostDetail per gestire lo stack
const _origClosePostDetail = closePostDetail;
closePostDetail = function() {
    _origClosePostDetail();
    // Se siamo arrivati dai commenti dal profilo, torna al profilo
    if (panelStack.length >= 2 && panelStack[panelStack.length - 1] === "comments") {
        panelStack.pop();
        document.getElementById("userProfilePanel").classList.remove("hidden");
    }
};

// ── MOBILE NAV ───────────────────────────────────────────────────────────────

let mobileActive = 'feed'; // 'left' | 'feed' | 'right'

function toggleMobileSidebar(panel) {
    if (window.innerWidth > 768) return;

    const left  = document.querySelector('.left');
    const right = document.querySelector('.right');
    const main  = document.querySelector('main');

    // Aggiorna stato
    mobileActive = panel;

    left.classList.toggle('mobile-open',  panel === 'left');
    right.classList.toggle('mobile-open', panel === 'right');

    // Evidenzia bottone attivo
    document.getElementById('mobileNavProfile').classList.toggle('active', panel === 'left');
    document.getElementById('mobileNavFeed').classList.toggle('active',    panel === 'feed');
    document.getElementById('mobileNavFriends').classList.toggle('active', panel === 'right');
}

// Chiudi sidebar mobile quando si apre una modale/pannello
function closeMobileSidebars() {
    if (window.innerWidth > 768) return;
    document.querySelector('.left').classList.remove('mobile-open');
    document.querySelector('.right').classList.remove('mobile-open');
    mobileActive = 'feed';
    document.getElementById('mobileNavFeed').classList.add('active');
    document.getElementById('mobileNavProfile').classList.remove('active');
    document.getElementById('mobileNavFriends').classList.remove('active');
}

// Chiudi sidebar su swipe veloce
(function setupSwipe() {
    let startX = 0, startY = 0;
    document.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
        if (dx < 0 && mobileActive === 'left')  toggleMobileSidebar('feed');
        if (dx > 0 && mobileActive === 'right') toggleMobileSidebar('feed');
        if (dx < 0 && mobileActive === 'feed')  toggleMobileSidebar('right');
        if (dx > 0 && mobileActive === 'feed')  toggleMobileSidebar('left');
    }, { passive: true });
})();

// ── START ─────────────────────────────────────────────────────────────────────
init();