// Strings loaded from strings.js

// ── TRADUTTORE ────────────────────────────────────────────────────────────────
let t = { ...BASE_STRINGS };

// Impostazioni traduzione
function getTranslateSettings() {
    return {
        ui:      localStorage.getItem("translateUI")      !== "false", // default true
        content: localStorage.getItem("translateContent") === "true",  // default false
    };
}
function saveTranslateSettings() {
    localStorage.setItem("translateUI",      document.getElementById("toggleTranslateUI").checked);
    localStorage.setItem("translateContent", document.getElementById("toggleTranslateContent").checked);
}
function initTranslateSettingsModal() {
    const s = getTranslateSettings();
    const ui = document.getElementById("toggleTranslateUI");
    const co = document.getElementById("toggleTranslateContent");
    if (ui) ui.checked = s.ui;
    if (co) co.checked = s.content;
}

// Traduzione singolo testo (per contenuti player)
async function translateText(text, targetLang) {
    if (!targetLang || targetLang === "it") return text;
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return data[0].map(chunk => chunk[0]).join("");
    } catch { return text; }
}

// Versione cache — incrementa ogni volta che aggiungi stringhe a strings.js

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

// ── THEME ──────────────────────────────────────────────────────────────────
(function initTheme() {
    if (localStorage.getItem("theme") === "light") {
        document.body.classList.add("light-theme");
    }
})();

function toggleTheme() {
    const isLight = document.body.classList.toggle("light-theme");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    // Aggiorna testo bottone
    const btn = document.getElementById("themeToggleBtn");
    if (btn) btn.innerHTML = isLight ? t.themeToggleLight : t.themeToggleDark;
}
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
let currentTab         = "all";    // "all" | "saved"
let currentPostImages  = [];       // carosello immagini post aperto
let carouselIndex      = 0;        // indice corrente carosello
let notifPollInterval  = null;
let editPostId         = null;
let linkPreviewCache   = {};       // cache URL → preview data
let commentClanTags    = {};       // cache username → clanTag

// Gestisce sia URL Cloudinary (https://...) che vecchi path locali (/uploads/...)
function imgUrl(src) {
    if (!src) return DEFAULT_PFP;
    if (src.startsWith("http")) return src;
    return `/uploads/${src}`;
}

function showAlert(msg, type = "warning") {
    document.getElementById("alertMessage").innerText = msg;
    document.getElementById("alertTitle").innerText   = type === "success" ? "✓" : t.warning;
    document.getElementById("alertTitle").style.color = type === "success" ? "#43b581" : "#ff4747";
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
                currentUser = { ...currentUser, ...fresh,
                    userClass: fresh.userClass||"", classChosen: fresh.classChosen||false,
                    level: fresh.level||1, rank: fresh.rank||"Player", tier: fresh.tier||0 };
                localStorage.setItem("user", JSON.stringify(currentUser));
            }
        } catch {
            // Server non raggiungibile — manteniamo lo stato locale
        }
    }
    initTranslateSettingsModal();
    const settings = getTranslateSettings();
    if (settings.ui) {
        t = await translateAll(currentLang);
        applyStaticTranslations();
    }
    updateUI();
    loadPosts();
    if (token) {
        startNotifPolling();
    }
    setupSearch();
}

// ── SEARCH ───────────────────────────────────────────────────────────────────
function setupSearch() {
    let searchTimer = null;
    const handler = (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadPosts(e.target.value.trim()), 350);
    };
    document.getElementById("searchInput")?.addEventListener("input", handler);
    document.getElementById("searchInputMobile")?.addEventListener("input", handler);
}

function switchTab(tab) {
    currentTab = tab;
    document.getElementById("tabAll").classList.toggle("active", tab === "all");
    document.getElementById("tabSaved").classList.toggle("active", tab === "saved");
    document.getElementById("tabFriends").classList.toggle("active", tab === "friends");
    loadPosts();
}

// ── RANK BADGE ────────────────────────────────────────────────────────────────
function rankBadgeHTML(level, rank, tier) {
    return `<span class="rank-badge rank-${tier}">${rank} · Lv.${level}</span>`;
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
function startNotifPolling() {
    loadNotifs();
    clearInterval(notifPollInterval);
    notifPollInterval = setInterval(loadNotifs, 15000);
}

async function loadNotifs() {
    if (!token) return;
    const res = await fetch("/notifications", { headers: { "Authorization": token } });
    if (!res.ok) return;
    const notifs = await res.json();
    const unread = notifs.filter(n => !n.read).length;
    const badge  = document.getElementById("notifBadge");
    if (badge) {
        badge.textContent = unread > 9 ? "9+" : unread;
        badge.classList.toggle("hidden", unread === 0);
    }
    renderNotifList(notifs);
}

const NOTIF_ICONS = { comment: "💬", reaction: "👍", friend_request: "👥", friend_accept: "🤝", mention: "@" };

function renderNotifList(notifs) {
    const list = document.getElementById("notifList");
    if (!list) return;
    if (!notifs.length) { list.innerHTML = `<div class="notif-empty">Nessuna notifica</div>`; return; }
    list.innerHTML = notifs.map(n => `
        <div class="notif-item ${n.read ? "" : "unread"}" data-id="${n._id}" onclick="handleNotifClick('${n._id}','${n.type}',${n.postId||0})">
            <div class="notif-icon">${NOTIF_ICONS[n.type] || "🔔"}</div>
            <div class="notif-body">
                <div class="notif-msg">${escapeHtml(n.message)}</div>
                <div class="notif-time">${formatRelTime(n.createdAt)}</div>
            </div>
            ${!n.read ? '<div class="notif-dot"></div>' : ''}
        </div>`).join("");
}

async function handleNotifClick(id, type, postId) {
    // Segna letta
    const item = document.querySelector(`.notif-item[data-id="${id}"]`);
    if (item) item.classList.remove("unread");
    // Azioni contestuali
    if ((type === "comment" || type === "reaction" || type === "mention") && postId) {
        closeNotifPanel();
        openPostDetail(postId);
    }
    await fetch(`/notifications/${id}`, { method: "DELETE", headers: { "Authorization": token } });
    loadNotifs();
}

async function markAllNotifsRead() {
    if (!token) return;
    await fetch("/notifications/read", { method: "POST", headers: { "Authorization": token } });
    loadNotifs();
}

function toggleNotifPanel() {
    const panel = document.getElementById("notifPanel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) loadNotifs();
}

function closeNotifPanel() {
    document.getElementById("notifPanel")?.classList.add("hidden");
}

// ── CLASS CHOICE ──────────────────────────────────────────────────────────────
async function chooseClass(userClass) {
    if (!token) return;
    const res = await fetch("/user/class", {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ userClass })
    });
    if (res.ok) {
        currentUser.userClass = userClass;
        currentUser.classChosen = true;
        localStorage.setItem("user", JSON.stringify(currentUser));
        closeModal("classChoiceModal");
        updateUI(); // aggiorna topbar con il nuovo rank
    }
}

// ── EDIT POST ─────────────────────────────────────────────────────────────────
function openEditPost(postId, currentTitle) {
    editPostId = postId;
    document.getElementById("editPostTitle").value = currentTitle;
    document.getElementById("editPostPanel").classList.remove("hidden");
}

function closeEditPost() {
    document.getElementById("editPostPanel").classList.add("hidden");
    editPostId = null;
}

async function submitEditPost() {
    if (!editPostId) return;
    const title = document.getElementById("editPostTitle").value.trim();
    if (!title) return showAlert(t.insertTitle);
    const res = await fetch(`/posts/${editPostId}`, {
        method: "PUT",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ title })
    });
    if (res.ok) {
        closeEditPost();
        loadPosts();
    }
}

// ── CAROUSEL ──────────────────────────────────────────────────────────────────
function initCarousel(images) {
    currentPostImages = images;
    carouselIndex = 0;
    renderCarousel();
    const nav = document.getElementById("carouselNav");
    if (nav) nav.classList.toggle("hidden", images.length <= 1);
    document.getElementById("carouselPrev").onclick = () => { carouselIndex = (carouselIndex - 1 + currentPostImages.length) % currentPostImages.length; renderCarousel(); };
    document.getElementById("carouselNext").onclick = () => { carouselIndex = (carouselIndex + 1) % currentPostImages.length; renderCarousel(); };
}

function renderCarousel() {
    const img = document.getElementById("detailPostImage");
    if (img) img.src = imgUrl(currentPostImages[carouselIndex] || "");
    const counter = document.getElementById("carouselCounter");
    if (counter) counter.textContent = `${carouselIndex + 1} / ${currentPostImages.length}`;
}

// ── SAVE POST ─────────────────────────────────────────────────────────────────
async function toggleSavePost() {
    if (!token) return showAlert("Accedi per salvare i post");
    const res = await fetch(`/posts/${currentOpenPostId}/save`, {
        method: "POST", headers: { "Authorization": token }
    });
    if (res.ok) {
        const data = await res.json();
        const btn = document.getElementById("savePostBtn");
        if (btn) {
            btn.textContent = data.saved ? "🔖 Salvato!" : "🔖 Salva Post";
            btn.classList.toggle("saved", data.saved);
        }
        loadPosts(); // aggiorna badge nel feed
    }
}

// ── LINK PREVIEW ──────────────────────────────────────────────────────────────
async function fetchLinkPreview(url) {
    if (linkPreviewCache[url]) return linkPreviewCache[url];
    try {
        const res = await fetch(`/link-preview?url=${encodeURIComponent(url)}`);
        if (!res.ok) return null;
        const data = await res.json();
        linkPreviewCache[url] = data;
        return data;
    } catch { return null; }
}

function renderTextWithLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const mentionRegex = /@(\w+)/g;
    let html = escapeHtml(text);
    html = html.replace(urlRegex, url => `<a href="${url}" target="_blank" style="color:var(--accent-text);">${url}</a>`);
    html = html.replace(mentionRegex, (m, username) => `<span class="mention" onclick="openProfilePanel('${username}')">${m}</span>`);
    return html;
}

async function maybeFetchLinkPreview(text, container) {
    const urls = text.match(/(https?:\/\/[^\s]+)/g);
    if (!urls) return;
    const preview = await fetchLinkPreview(urls[0]);
    if (!preview || !preview.title) return;
    const div = document.createElement("div");
    div.className = "link-preview";
    div.onclick = () => window.open(preview.url, "_blank");
    div.innerHTML = `
        ${preview.image ? `<img class="link-preview-img" src="${preview.image}" onerror="this.style.display='none'">` : ""}
        <div class="link-preview-body">
            <div class="link-preview-domain">${escapeHtml(preview.domain)}</div>
            <div class="link-preview-title">${escapeHtml(preview.title)}</div>
            ${preview.description ? `<div class="link-preview-desc">${escapeHtml(preview.description)}</div>` : ""}
        </div>`;
    container.appendChild(div);
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
    const tabFr = document.getElementById("tabFriends");
    if (tabFr) tabFr.innerText = t.tabFriends;
    const tabLb = document.getElementById("tabLeaderboard");
    if (tabLb) tabLb.innerText = t.tabLeaderboard;
    const achLbl = document.getElementById("achievementsLabel");
    if (achLbl) achLbl.innerText = t.achievementsLabel;
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
        const rankInfo = (currentUser.rank && currentUser.tier !== undefined)
            ? rankBadgeHTML(currentUser.level||1, currentUser.rank, currentUser.tier)
            : "";
        const clanTagDisplay = currentUser.clanTag ? `<span class="user-clan-tag">[${escapeHtml(currentUser.clanTag)}]</span>` : "";
        authArea.innerHTML = `
            <div class="user-profile-nav" onclick="toggleMenu('logoutMenu')">
                <img src="${pfp}" onerror="this.src='${DEFAULT_PFP}'">
                <div style="display:flex;flex-direction:column;gap:1px;">
                    <span>${clanTagDisplay}${currentUser.username}</span>
                    <span style="font-size:11px;">${rankInfo}</span>
                </div>
                <div id="logoutMenu" class="logout-confirm hidden" onclick="event.stopPropagation()">
                    <button onclick="openEditProfile()" class="btn-main" style="margin-bottom:10px">${t.editProfile}</button>
                    <div class="lang-dropdown-container">
                        <button class="btn-secondary" onclick="toggleMenu('langList')">
                            ${currentLangObj.flag} ${currentLangObj.label} ▼
                        </button>
                        <div id="langList" class="lang-list hidden">${buildLangList()}</div>
                    </div>
                    <button onclick="toggleTheme()" id="themeToggleBtn" class="theme-toggle-btn">${document.body.classList.contains('light-theme') ? t.themeToggleLight : t.themeToggleDark}</button>
                    <button onclick="openLogoutConfirm()" class="btn-secondary" style="background:var(--danger); color:white; margin-top:6px">${t.logout}</button>
                </div>
            </div>`;
        rightSidebar.classList.remove("locked");
        document.getElementById("commentInputArea").classList.remove("hidden");
        document.getElementById("commentLoginMsg").classList.add("hidden");
        document.getElementById("commentMeAvatar").src = imgUrl(currentUser.profileImage);
        loadMyPosts();
        loadFriendsData();
        startPolling();
        // Mostra scelta classe se non ancora scelta
        if (currentUser && !currentUser.classChosen) {
            document.getElementById("classChoiceModal").classList.remove("hidden");
        }
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
            // Dopo il register: esegui login automatico e mostra scelta classe
            const loginRes = await fetch("/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: document.getElementById("authUsername").value, password: document.getElementById("authPassword").value })
            });
            if (loginRes.ok) {
                const loginData = await loginRes.json();
                localStorage.setItem("token", loginData.token);
                localStorage.setItem("user", JSON.stringify(loginData));
                token = loginData.token;
                currentUser = loginData;
                closeModal("authModal");
                t = await translateAll(currentLang);
                applyStaticTranslations();
                updateUI();
                loadPosts();
                startNotifPolling();
                // Mostra scelta classe
                document.getElementById("classChoiceModal").classList.remove("hidden");
            } else {
                showAlert(t.regDone, "success");
                isLoginMode = true;
                updateAuthModal();
            }
        }
    } else { showAlert(await res.text() || "Errore"); }
};
function openEditProfile() {
    document.getElementById("logoutMenu").classList.add("hidden");
    if (currentUser) {
        document.getElementById("editUsernameInput").value = currentUser.username || "";
        document.getElementById("editPfpPreview").src = imgUrl(currentUser.profileImage);
        document.getElementById("editBioInput").value = currentUser.bio || "";
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
    const files = document.getElementById("postImageFile").files;
    const url   = document.getElementById("postImageUrl").value;
    if (!title) return showAlert(t.insertTitle);
    const fd = new FormData();
    fd.append("title", title);
    if (files.length > 0) {
        Array.from(files).forEach(f => fd.append("images", f));
    } else if (url && !document.getElementById("postImageUrl").dataset.fileSelected) {
        fd.append("imageUrl", url);
    }
    const res = await fetch("/posts", { method: "POST", headers: { "Authorization": token }, body: fd });
    if (res.ok) {
        closeModal("createModal");
        document.getElementById("postTitle").value = "";
        document.getElementById("postImageUrl").value = "";
        document.getElementById("postImageFile").value = "";
        document.getElementById("imagePreviewGrid").classList.add("hidden");
        document.getElementById("imagePreviewGrid").innerHTML = "";
        loadPosts();
        loadMyPosts();
    }
};

document.addEventListener('change', (e) => {
    if (e.target.id === 'postImageFile' && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        document.getElementById("postImageUrl").value = files.length === 1 ? files[0].name : `${files.length} immagini`;
        document.getElementById("postImageUrl").dataset.fileSelected = "true";
        const grid = document.getElementById("imagePreviewGrid");
        grid.innerHTML = "";
        grid.classList.remove("hidden");
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = document.createElement("img");
                img.src = ev.target.result;
                grid.appendChild(img);
            };
            reader.readAsDataURL(file);
        });
    }
    if ((e.target.id === 'registerPfpFile' || e.target.id === 'editPfpFile') && e.target.files[0]) {
        const reader = new FileReader();
        const prevId = e.target.id === 'registerPfpFile' ? "registerPfpPreview" : "editPfpPreview";
        reader.onload = (ex) => document.getElementById(prevId).src = ex.target.result;
        reader.readAsDataURL(e.target.files[0]);
    }
});

async function loadPosts(search) {
    const me = currentUser ? currentUser.username : "";
    let url = `/posts?me=${encodeURIComponent(me)}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    const res   = await fetch(url);
    const posts = await res.json();
    const container = document.getElementById("posts");
    container.innerHTML = "";

    let filtered = [...posts].reverse();
    // Tab filters
    if (currentTab === "saved") {
        filtered = filtered.filter(p => p.savedByMe);
    } else if (currentTab === "friends") {
        filtered = filtered.filter(p => myFriends.has(p.author));
    }
    if (filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:40px;font-size:14px;">${currentTab === "saved" ? "🔖 Nessun post salvato" : "Nessun post trovato"}</div>`;
        return;
    }
    for (const post of filtered) {
        let commentCount = 0;
        try {
            const cr = await fetch(`/posts/${post.id}/comments`);
            const cs = await cr.json();
            commentCount = cs.length;
        } catch {}

        const div = document.createElement("div");
        div.className = "post";
        const imgSrc = imgUrl(post.image || (post.images && post.images[0]) || "");
        const isOwner = currentUser && post.author === currentUser.username;
        const multiImg = post.images && post.images.length > 1;
        div.innerHTML = `
            <div class="post-header">
                <h3>${escapeHtml(post.title)}</h3>
                <small>${t.by} <span style="cursor:pointer;color:var(--accent-text)" onclick="openProfilePanel('${escapeHtml(post.author)}')">${escapeHtml(post.author)}</span></small>
                ${isOwner ? `<button class="post-edit-btn" onclick="openEditPost(${post.id},'${escapeHtml(post.title).replace(/'/g,"\'")}')">✏️</button>` : ""}
            </div>
            <div style="position:relative;">
                <img src="${imgSrc}" onerror="this.src='${DEFAULT_PFP}'" data-post-id="${post.id}" style="cursor:pointer;">
                ${multiImg ? `<span style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);color:white;font-size:11px;padding:2px 7px;border-radius:20px;">📷 ${post.images.length}</span>` : ""}
            </div>
            <div class="post-actions-row">
                <button class="post-action-btn ${post.myPostReaction==='up'?'active-up':''}" data-pid="${post.id}" data-r="up">👍 <span>${post.postUps||0}</span></button>
                <button class="post-action-btn ${post.myPostReaction==='down'?'active-down':''}" data-pid="${post.id}" data-r="down">👎 <span>${post.postDowns||0}</span></button>
                <button class="post-action-btn ${post.savedByMe?'saved':''}" data-save="${post.id}">🔖 ${post.savedByMe?"Salvato":"Salva"}</button>
                <div class="post-comment-count" data-post-id="${post.id}">💬 ${commentCount}</div>
            </div>`;

        div.querySelector("img").onclick = () => openPostDetail(post);
        div.querySelector(".post-comment-count").onclick = () => openPostDetail(post);

        // Translate button for post title
        if (getTranslateSettings().content && currentLang !== "it") {
            const tBtn = document.createElement("button");
            tBtn.className = "translate-btn";
            tBtn.textContent = t.translateBtn || "Traduci";
            let translated = false;
            const originalTitle = post.title;
            tBtn.onclick = async (e) => {
                e.stopPropagation();
                const h3 = div.querySelector("h3");
                if (!translated) {
                    tBtn.textContent = t.translating || "...";
                    h3.textContent = await translateText(originalTitle, currentLang);
                    tBtn.textContent = t.showOriginal || "Originale";
                    translated = true;
                } else {
                    h3.textContent = originalTitle;
                    tBtn.textContent = t.translateBtn || "Traduci";
                    translated = false;
                }
            };
            div.querySelector(".post-header").appendChild(tBtn);
        }

        // Post reactions
        div.querySelectorAll(".post-action-btn[data-r]").forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                if (!token) return showAlert("Accedi per reagire");
                const r = await fetch(`/posts/${btn.dataset.pid}/react`, {
                    method: "POST",
                    headers: { "Authorization": token, "Content-Type": "application/json" },
                    body: JSON.stringify({ reaction: btn.dataset.r })
                });
                if (r.ok) loadPosts(search);
            };
        });

        // Save
        const saveBtn = div.querySelector(".post-action-btn[data-save]");
        if (saveBtn) saveBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!token) return showAlert("Accedi per salvare i post");
            const r = await fetch(`/posts/${saveBtn.dataset.save}/save`, {
                method: "POST", headers: { "Authorization": token }
            });
            if (r.ok) loadPosts(search);
        };

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

async function openPostDetail(postOrId) {
    // Accetta sia oggetto post che solo id
    let post = postOrId;
    if (typeof postOrId === "number") {
        try {
            const r = await fetch("/posts?me=" + (currentUser ? currentUser.username : ""));
            const all = await r.json();
            post = all.find(p => p.id === postOrId);
            if (!post) return;
        } catch { return; }
    }
    currentOpenPostId     = post.id;
    currentOpenPostAuthor = post.author;

    document.getElementById("detailPostTitle").textContent = post.title || "";
    document.getElementById("detailAuthorName").innerText = post.author || "";
    document.getElementById("detailPostDate").innerText = post.id ? formatDate(post.id) : "";

    // Carosello immagini
    const images = (post.images && post.images.length > 0) ? post.images : (post.image ? [post.image] : []);
    initCarousel(images);

    // Save button stato
    const saveBtn = document.getElementById("savePostBtn");
    if (saveBtn) {
        saveBtn.textContent = post.savedByMe ? "🔖 Salvato!" : "🔖 Salva Post";
        saveBtn.classList.toggle("saved", !!post.savedByMe);
    }

    // Post reactions row
    const reactRow = document.getElementById("postReactionsRow");
    if (reactRow) {
        reactRow.innerHTML = `
            <button class="post-action-btn ${post.myPostReaction==='up'?'active-up':''}" id="detailReactUp">👍 <span id="detailUps">${post.postUps||0}</span></button>
            <button class="post-action-btn ${post.myPostReaction==='down'?'active-down':''}" id="detailReactDown">👎 <span id="detailDowns">${post.postDowns||0}</span></button>`;
        reactRow.querySelector("#detailReactUp").onclick = () => reactToOpenPost("up");
        reactRow.querySelector("#detailReactDown").onclick = () => reactToOpenPost("down");
    }

    try {
        const ur = await fetch(`/users/profile/${encodeURIComponent(post.author)}`);
        if (ur.ok) {
            const u = await ur.json();
            document.getElementById("detailAuthorAvatar").src = imgUrl(u.profileImage);
            const rankEl = document.getElementById("detailAuthorRank");
            if (rankEl && u.rank !== undefined) rankEl.innerHTML = rankBadgeHTML(u.level, u.rank, u.tier);
        } else { document.getElementById("detailAuthorAvatar").src = DEFAULT_PFP; }
    } catch { document.getElementById("detailAuthorAvatar").src = DEFAULT_PFP; }

    document.getElementById("postDetailPanel").classList.remove("hidden");
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
    document.getElementById("postDetailPanel").classList.add("hidden");
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
    // Get clan tag for comment author
    const commentClanTag = commentClanTags[c.author] || "";
    if (!commentClanTags[c.author]) {
        fetch(`/users/profile/${encodeURIComponent(c.author)}`).then(r=>r.ok?r.json():null).then(u=>{
            if (u && u.clanTag) {
                commentClanTags[c.author] = u.clanTag;
                const tagEl = div.querySelector(".comment-clan-tag");
                if (tagEl) tagEl.textContent = `[${u.clanTag}]`;
            }
        });
    }
    div.innerHTML = `
        <img class="comment-avatar" src="${pfp}" onerror="this.src='${DEFAULT_PFP}'">
        <div class="comment-body">
            ${canDelete ? `<button class="comment-delete-btn" title="Elimina">✕</button>` : ""}
            <div class="comment-username-row">
                <span class="comment-clan-tag" style="font-size:10px;color:var(--accent);font-weight:700;margin-right:3px;">${commentClanTag ? `[${commentClanTag}]` : ""}</span>
                <span class="comment-username">${c.author || "Utente"}</span>
                ${c.author === currentOpenPostAuthor ? `<span class="badge badge-op">${t.badgeOp}</span>` : ""}
                ${currentUser && c.author !== currentUser.username && myFriends.has(c.author) ? `<span class="badge badge-friend">${t.badgeFriend}</span>` : ""}
            </div>
            <div class="comment-text">${renderTextWithLinks(c.text || "")}</div>
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

    // Async link preview
    maybeFetchLinkPreview(c.text || "", div.querySelector(".comment-body"));

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
function openModal(id)  { document.getElementById(id).classList.remove("hidden"); }
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

document.getElementById("openCreate").onclick = () => {
    // Reset form
    document.getElementById("postTitle").value = "";
    document.getElementById("postImageUrl").value = "";
    document.getElementById("postImageUrl").dataset.fileSelected = "false";
    document.getElementById("postImageFile").value = "";
    document.getElementById("createModal").classList.remove("hidden");
};
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
    const notifPanel = document.getElementById("notifPanel");
    const notifBtn   = document.getElementById("notifBtn");
    if (notifPanel && !notifPanel.classList.contains("hidden") && !notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
        notifPanel.classList.add("hidden");
    }
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

function openProfilePanel(username) { openUserProfile(username); }

async function openUserProfile(username) {
    profilePanelUser = username;
    panelStack = ["profile"];

    const res  = await fetch(`/users/profile/${encodeURIComponent(username)}`);
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById("profilePanelAvatar").src = imgUrl(data.profileImage);
    document.getElementById("profilePanelUsername").innerText = data.username;

    const rankEl = document.getElementById("profilePanelRank");
    if (rankEl && data.rank !== undefined) rankEl.innerHTML = rankBadgeHTML(data.level||1, data.rank, data.tier||0);

    const bioEl = document.getElementById("profilePanelBio");
    if (bioEl) bioEl.textContent = data.bio || "";

    const statsEl = document.getElementById("profilePanelStats");
    if (statsEl) {
        const nextTierLevels = [20, 40, 80, 130];
        const lvl  = data.level || 1;
        const next = nextTierLevels.find(n => n > lvl) || 999;
        const prev = [...nextTierLevels].reverse().find(n => n <= lvl) || 1;
        const pct  = next === 999 ? 100 : Math.round(((lvl - prev) / (next - prev)) * 100);
        statsEl.innerHTML = `
            <span class="stat-badge ups">👍 ${data.totalUps||0}</span>
            <span class="stat-badge downs">👎 ${data.totalDowns||0}</span>
            <div class="level-bar-wrap">
                <div class="level-bar-label"><span>Lv. ${lvl}</span><span>${next===999?"MAX":"→ Lv."+next}</span></div>
                <div class="level-bar-track"><div class="level-bar-fill" style="width:${pct}%"></div></div>
            </div>`;
    }

    // Achievements & Clan badge
    loadAchievements(username);
    loadClanBadge(username, data.clanTag, data.clanName);

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
    document.getElementById("postDetailPanel").classList.add("hidden");
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

// ── POST REACTIONS FROM DETAIL PANEL ─────────────────────────────────────────
async function reactToOpenPost(reaction) {
    if (!token) return showAlert("Accedi per reagire");
    const res = await fetch(`/posts/${currentOpenPostId}/react`, {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ reaction })
    });
    if (res.ok) {
        const data = await res.json();
        const upBtn   = document.getElementById("detailReactUp");
        const downBtn = document.getElementById("detailReactDown");
        if (upBtn)   { upBtn.querySelector("span").textContent = data.postUps; upBtn.classList.toggle("active-up", data.myPostReaction==="up"); upBtn.classList.remove("active-down"); }
        if (downBtn) { downBtn.querySelector("span").textContent = data.postDowns; downBtn.classList.toggle("active-down", data.myPostReaction==="down"); downBtn.classList.remove("active-up"); }
    }
}

// ── FEEDBACK ─────────────────────────────────────────────────────────────────

function openFeedback() {
    document.getElementById("feedbackText").value = "";
    document.getElementById("feedbackModal").classList.remove("hidden");
}

async function submitFeedback() {
    const text     = document.getElementById("feedbackText").value.trim();
    const category = document.getElementById("feedbackCategory").value;
    if (!text) return showAlert(t.feedbackEmpty);
    const res = await fetch("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "Authorization": token } : {}) },
        body: JSON.stringify({ text, category })
    });
    if (res.ok) {
        closeModal("feedbackModal");
        showAlert(t.feedbackSent, "success");
    } else {
        showAlert(await res.text() || "Errore invio feedback");
    }
}

// ── LEADERBOARD ──────────────────────────────────────────────────────────────

async function openLeaderboard() {
    const panel = document.getElementById("leaderboardPanel");
    panel.classList.remove("hidden");
    document.getElementById("leaderboardList").innerHTML = "<div style='text-align:center;padding:30px;color:var(--text-muted)'>⏳ Caricamento...</div>";
    const res = await fetch("/leaderboard/weekly");
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById("leaderboardList");
    if (!data.length) { list.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:24px">${t.leaderboardEmpty}</div>`; return; }
    const medals = ["🥇","🥈","🥉"];
    list.innerHTML = data.map((u, i) => `
        <div class="leaderboard-item" onclick="openProfilePanel('${escapeHtml(u.username)}')">
            <div class="lb-rank">${medals[i] || (i+1)}</div>
            <img class="lb-avatar" src="${imgUrl(u.profileImage)}" onerror="this.src='${DEFAULT_PFP}'">
            <div class="lb-info">
                <div class="lb-username">${escapeHtml(u.username)}</div>
                <div class="lb-rank-badge">${rankBadgeHTML(u.level||1, u.rank||"Player", u.tier||0)}</div>
            </div>
            <div class="lb-ups">👍 ${u.ups}</div>
        </div>`).join("");
}

function closeLeaderboard() {
    document.getElementById("leaderboardPanel").classList.add("hidden");
}

// ── CLAN ─────────────────────────────────────────────────────────────────────

let myClan = null;

async function openClanPanel() {
    document.getElementById("clanPanel").classList.remove("hidden");
    await refreshClanPanel();
}

function closeClanPanel() {
    document.getElementById("clanPanel").classList.add("hidden");
    if (clanChatPolling) { clearInterval(clanChatPolling); clanChatPolling = null; }
}

async function refreshClanPanel() {
    const content = document.getElementById("clanPanelContent");
    content.innerHTML = "<div style='text-align:center;padding:30px;color:var(--text-muted)'>⏳ Caricamento...</div>";
    if (!token) {
        content.innerHTML = "<p style='color:var(--text-muted);text-align:center;padding:24px'>Accedi per vedere i clan.</p>";
        return;
    }
    const res = await fetch("/clan/my", { headers: { "Authorization": token } });
    myClan = res.ok ? await res.json() : null;

    if (myClan) {
        renderMyClan(myClan);
    } else {
        renderClanBrowser();
    }
}

let clanChatPolling = null;

function renderMyClan(clan) {
    const isLeader = clan.leader === (currentUser && currentUser.username);
    const content  = document.getElementById("clanPanelContent");
    const clanImg  = clan.image
        ? `<img src="${clan.image}" class="clan-image-big">`
        : `<div class="clan-tag-big">[${escapeHtml(clan.tag)}]</div>`;

    content.innerHTML = `
        <div class="clan-header">
            ${clanImg}
            <div style="flex:1">
                <h2 class="clan-name-big">${escapeHtml(clan.name)}</h2>
                <p class="clan-desc">${escapeHtml(clan.description || "")}</p>
                ${isLeader ? `<button class="btn-secondary" style="font-size:12px;padding:4px 12px;margin-top:8px" onclick="showEditClanForm()">✏️ ${t.clanEdit}</button>` : ""}
            </div>
        </div>
        <div class="clan-tabs-row">
            <button class="clan-tab-btn active" id="clanTabMembers" onclick="showClanTab('members')">👥 ${t.clanMembers}</button>
            <button class="clan-tab-btn" id="clanTabChat" onclick="showClanTab('chat')">💬 ${t.clanChat}</button>
        </div>
        <div id="clanTabContent"></div>
        <div style="margin-top:16px">
            <button class="btn-secondary" style="color:var(--danger);border-color:var(--danger);font-size:12px" onclick="leaveClan()">${t.clanLeave}</button>
        </div>`;

    showClanMembersTab(clan, isLeader);
}

function showClanTab(tab) {
    document.getElementById("clanTabMembers").classList.toggle("active", tab === "members");
    document.getElementById("clanTabChat").classList.toggle("active", tab === "chat");
    if (tab === "members") {
        if (clanChatPolling) { clearInterval(clanChatPolling); clanChatPolling = null; }
        showClanMembersTab(myClan, myClan && myClan.leader === (currentUser && currentUser.username));
    } else {
        openClanChat();
    }
}

function showClanMembersTab(clan, isLeader) {
    const container = document.getElementById("clanTabContent");
    container.innerHTML = `<div class="clan-members-list" id="clanMembersList"></div>`;
    const membersList = document.getElementById("clanMembersList");
    clan.members.forEach(username => {
        const div = document.createElement("div");
        div.className = "clan-member-item";
        div.innerHTML = `
            <img src="${DEFAULT_PFP}" class="clan-member-avatar">
            <span class="clan-member-name" onclick="openProfilePanel('${escapeHtml(username)}')" style="cursor:pointer">${escapeHtml(username)}</span>
            ${username === clan.leader ? `<span class="clan-leader-badge">${t.clanLeader}</span>` : ""}
            ${isLeader && username !== clan.leader ? `<button class="clan-kick-btn" onclick="kickFromClan('${escapeHtml(username)}')">✕</button>` : ""}`;
        fetch(`/users/profile/${encodeURIComponent(username)}`).then(r => r.ok ? r.json() : null).then(u => {
            if (u && u.profileImage) div.querySelector("img").src = imgUrl(u.profileImage);
        });
        membersList.appendChild(div);
    });
}

async function openClanChat() {
    const container = document.getElementById("clanTabContent");
    container.innerHTML = `
        <div class="clan-chat-wrap">
            <div class="clan-chat-messages" id="clanChatMessages"><div style="text-align:center;color:var(--text-muted);padding:20px">⏳</div></div>
            <div class="clan-chat-input-row">
                <input type="text" id="clanChatInput" class="clan-chat-input" placeholder="${t.clanChatPlaceholder}" maxlength="500">
                <button class="clan-chat-send" onclick="sendClanMessage()">➤</button>
            </div>
        </div>`;
    document.getElementById("clanChatInput").addEventListener("keydown", e => {
        if (e.key === "Enter") sendClanMessage();
    });
    await loadClanMessages();
    if (clanChatPolling) clearInterval(clanChatPolling);
    clanChatPolling = setInterval(loadClanMessages, 4000);
}

async function loadClanMessages() {
    if (!myClan || !token) return;
    const res = await fetch(`/clan/${encodeURIComponent(myClan.name)}/messages`, { headers: { "Authorization": token } });
    if (!res.ok) return;
    const msgs = await res.json();
    const container = document.getElementById("clanChatMessages");
    if (!container) { clearInterval(clanChatPolling); clanChatPolling = null; return; }
    if (!msgs.length) { container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:20px">${t.clanNoMessages}</div>`; return; }
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 30;
    container.innerHTML = msgs.map(m => {
        const isMe = currentUser && m.author === currentUser.username;
        return `<div class="clan-msg ${isMe?"clan-msg-me":"clan-msg-other"}">
            ${!isMe ? `<span class="clan-msg-author" onclick="openProfilePanel('${escapeHtml(m.author)}')">${escapeHtml(m.author)}</span>` : ""}
            <div class="clan-msg-bubble">${escapeHtml(m.text)}</div>
            <div class="clan-msg-time">${formatRelTime(m.createdAt)}</div>
        </div>`;
    }).join("");
    if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

async function sendClanMessage() {
    const input = document.getElementById("clanChatInput");
    const text = input?.value?.trim();
    if (!text || !myClan || !token) return;
    input.value = "";
    const res = await fetch(`/clan/${encodeURIComponent(myClan.name)}/messages`, {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ text })
    });
    if (res.ok) loadClanMessages();
    else showAlert(await res.text());
}

function showEditClanForm() {
    if (!myClan) return;
    const content = document.getElementById("clanPanelContent");
    content.innerHTML = `
        <button class="btn-secondary" style="margin-bottom:16px" onclick="refreshClanPanel()">← Indietro</button>
        <h2 style="font-family:'Rajdhani',sans-serif;font-size:20px;color:var(--accent-text);margin-bottom:16px;">✏️ ${t.clanEdit}</h2>
        <input type="text" id="editClanName" class="custom-input" placeholder="${t.clanNameLabel}..." value="${escapeHtml(myClan.name)}">
        <textarea id="editClanDesc" class="custom-input" style="resize:vertical;min-height:60px" placeholder="${t.clanDescLabel}...">${escapeHtml(myClan.description||"")}</textarea>
        <div style="margin-bottom:12px">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px">Immagine clan (sostituisce il tag)</label>
            ${myClan.image ? `<img src="${myClan.image}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;margin-bottom:8px;display:block">` : ""}
            <label for="editClanImageFile" class="btn-secondary" style="cursor:pointer;font-size:12px;display:inline-block">📁 Carica Immagine</label>
            <input type="file" id="editClanImageFile" accept="image/*" style="display:none">
        </div>
        <button class="btn-main" onclick="submitEditClan()">Salva Modifiche</button>`;
}

async function submitEditClan() {
    if (!myClan || !token) return;
    const fd = new FormData();
    fd.append("newName",     document.getElementById("editClanName").value.trim());
    fd.append("description", document.getElementById("editClanDesc").value.trim());
    const file = document.getElementById("editClanImageFile").files[0];
    if (file) fd.append("image", file);
    const res = await fetch(`/clan/${encodeURIComponent(myClan.name)}`, {
        method: "PUT",
        headers: { "Authorization": token },
        body: fd
    });
    if (res.ok) {
        myClan = await res.json();
        // Refresh clan tag in currentUser
        currentUser.clanTag = myClan.tag;
        currentUser.clanName = myClan.name;
        localStorage.setItem("user", JSON.stringify(currentUser));
        updateUI();
        await refreshClanPanel();
    } else { showAlert(await res.text()); }
}

function renderClanBrowser() {
    const content = document.getElementById("clanPanelContent");
    content.innerHTML = `
        <h2 style="font-family:'Rajdhani',sans-serif;font-size:22px;color:var(--accent-text);margin-bottom:16px;">🏰 Clan</h2>
        <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px;">${t.clanNone}</p>
        <div style="display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap;">
            <button class="btn-main" onclick="showCreateClanForm()">${t.clanCreate}</button>
        </div>
        <div style="margin-bottom:12px;">
            <input type="text" id="clanSearchInput" class="custom-input" placeholder="🔍 ${t.clanSearch}" oninput="searchClans(this.value)">
        </div>
        <div id="clanSearchResults" class="clan-search-results"></div>`;
    searchClans("");
}

async function searchClans(q) {
    const res = await fetch(`/clan/search?q=${encodeURIComponent(q)}`);
    const clans = await res.json();
    const container = document.getElementById("clanSearchResults");
    if (!container) return;
    if (!clans.length) { container.innerHTML = "<p style='color:var(--text-muted);font-size:13px;text-align:center;padding:16px'>Nessun clan trovato</p>"; return; }
    container.innerHTML = clans.map(c => `
        <div class="clan-search-item">
            <div class="clan-tag-small">[${escapeHtml(c.tag)}]</div>
            <div class="clan-search-info">
                <div class="clan-search-name">${escapeHtml(c.name)}</div>
                <div class="clan-search-desc">${escapeHtml(c.description||"")} · ${c.members.length} membri</div>
            </div>
            <button class="btn-main" style="padding:6px 14px;font-size:12px" onclick="joinClan('${escapeHtml(c.name)}')">${t.clanJoinBtn}</button>
        </div>`).join("");
}

function showCreateClanForm() {
    const content = document.getElementById("clanPanelContent");
    content.innerHTML = `
        <button class="btn-secondary" style="margin-bottom:16px" onclick="refreshClanPanel()">← Indietro</button>
        <h2 style="font-family:'Rajdhani',sans-serif;font-size:22px;color:var(--accent-text);margin-bottom:20px;">👑 ${t.clanCreate}</h2>
        <input type="text" id="clanNameInput" class="custom-input" placeholder="${t.clanNameLabel}..." maxlength="30">
        <div class="clan-tag-input-wrap">
            <input type="text" id="clanTagInput" class="custom-input" placeholder="${t.clanTagLabel}..." maxlength="5" style="text-transform:uppercase;margin-bottom:0">
            <div class="clan-tag-tooltip-icon" tabindex="0">ℹ️
                <div class="clan-tag-tooltip-box">${t.clanTagTooltip}</div>
            </div>
        </div>
        <textarea id="clanDescInput" class="custom-input" placeholder="${t.clanDescLabel}..." style="resize:vertical;min-height:60px;max-length:200"></textarea>
        <button class="btn-main" onclick="createClan()">${t.clanCreateBtn}</button>`;
}

async function createClan() {
    const name = document.getElementById("clanNameInput").value.trim();
    const tag  = document.getElementById("clanTagInput").value.trim().toUpperCase();
    const desc = document.getElementById("clanDescInput").value.trim();
    if (!name || !tag) return showAlert("Nome e tag obbligatori");
    const res = await fetch("/clan/create", {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ name, tag, description: desc })
    });
    if (res.ok) { await refreshClanPanel(); }
    else { showAlert(await res.text()); }
}

async function joinClan(name) {
    const res = await fetch("/clan/join", {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
    if (res.ok) { await refreshClanPanel(); }
    else { showAlert(await res.text()); }
}

async function leaveClan() {
    const res = await fetch("/clan/leave", {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" }
    });
    if (res.ok) { myClan = null; await refreshClanPanel(); }
    else { showAlert(await res.text()); }
}

async function kickFromClan(username) {
    const res = await fetch("/clan/kick", {
        method: "POST",
        headers: { "Authorization": token, "Content-Type": "application/json" },
        body: JSON.stringify({ username })
    });
    if (res.ok) { await refreshClanPanel(); }
    else { showAlert(await res.text()); }
}

// ── ACHIEVEMENTS ─────────────────────────────────────────────────────────────

let achievementsPanelUser = null;
let achFilter = "all";

async function openAchievementsPanelFor(username) {
    if (!username) return;
    achievementsPanelUser = username;
    document.getElementById("achievementsPanel").classList.remove("hidden");
    await renderAchievementsPanel();
}

function closeAchievementsPanel() {
    document.getElementById("achievementsPanel").classList.add("hidden");
}

async function renderAchievementsPanel() {
    const res = await fetch(`/users/${encodeURIComponent(achievementsPanelUser)}/achievements`);
    if (!res.ok) return;
    const all = await res.json();
    const unlocked = all.filter(a => a.unlocked);
    const locked   = all.filter(a => !a.unlocked);

    document.getElementById("achievementsSubtitle").textContent =
        `${unlocked.length} / ${all.length} sbloccati`;

    // Filter row
    const cats = ["all", "post", "like", "social", "rank", "clan", "special"];
    const catLabels = { all:"Tutti", post:"📝 Post", like:"👍 Like", social:"👥 Social", rank:"🎖️ Rank", clan:"🏰 Clan", special:"✨ Speciali" };
    document.getElementById("achFilterRow").innerHTML = cats.map(c =>
        `<button class="ach-filter-btn ${c===achFilter?"active":""}" onclick="setAchFilter('${c}')">${catLabels[c]}</button>`
    ).join("");

    let filtered = all;
    if (achFilter !== "all") filtered = all.filter(a => a.category === achFilter);

    document.getElementById("achievementsPanelGrid").innerHTML = filtered.map(a => `
        <div class="achievement-panel-item ${a.unlocked?"unlocked":"locked"}">
            <div class="ach-icon-big">${a.unlocked ? a.icon : "🔒"}</div>
            <div class="ach-info">
                <div class="ach-name">${escapeHtml(a.name)}</div>
                <div class="ach-desc">${escapeHtml(a.desc)}</div>
                ${a.unlocked && a.unlockedAt ? `<div class="ach-date">Sbloccato il ${new Date(a.unlockedAt).toLocaleDateString("it")}</div>` : ""}
            </div>
            ${a.unlocked ? '<div class="ach-check">✓</div>' : ""}
        </div>`).join("");
}

function setAchFilter(f) {
    achFilter = f;
    renderAchievementsPanel();
}

async function loadAchievements(username) {
    const res = await fetch(`/users/${encodeURIComponent(username)}/achievements`);
    if (!res.ok) return;
    const achievements = await res.json();
    const grid = document.getElementById("profilePanelAchievements");
    if (!grid) return;
    const unlocked = achievements.filter(a => a.unlocked).slice(0, 6);
    grid.innerHTML = unlocked.map(a => `
        <div class="achievement-badge unlocked" title="${escapeHtml(a.name)}: ${escapeHtml(a.desc)}">
            <div class="achievement-icon">${a.icon}</div>
            <div class="achievement-name">${escapeHtml(a.name)}</div>
        </div>`).join("") +
        `<div class="achievement-badge" style="cursor:pointer" onclick="openAchievementsPanelFor('${escapeHtml(username)}')" title="Vedi tutti">
            <div class="achievement-icon">➕</div>
            <div class="achievement-name">Tutti</div>
        </div>`;
}

async function loadClanBadge(username, clanTag, clanName) {
    const el = document.getElementById("profilePanelClan");
    if (!el) return;
    if (clanTag) {
        el.style.display = "flex";
        el.innerHTML = `<span class="clan-tag-profile">[${escapeHtml(clanTag)}]</span> <span class="clan-name-profile">${escapeHtml(clanName||"")}</span>`;
    } else {
        el.style.display = "none";
    }
}

// ── START ─────────────────────────────────────────────────────────────────────
init();