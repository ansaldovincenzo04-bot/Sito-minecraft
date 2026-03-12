// ══════════════════════════════════════════════════════
//  HUNTERS UNIVERSE — Translation Strings
//  Questo file contiene TUTTE le stringhe dell'interfaccia.
//  NON modificare script.js per aggiungere stringhe, fallo qui.
// ══════════════════════════════════════════════════════

const STRINGS_VERSION = "v6";

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
    // Tema
    themeToggleDark:  "☀️ Passa al Tema Chiaro",
    themeToggleLight: "🌙 Passa al Tema Scuro",
    // Feedback
    feedbackSent:     "Grazie per il tuo feedback!",
    feedbackEmpty:    "Scrivi qualcosa prima di inviare.",
    // Mobile nav
    mobileProfile:    "Profilo",
    mobileFeed:       "Home",
    mobileFriends:    "Amici",
    // Feed tabs
    tabAll:           "🏠 Feed",
    tabSaved:         "🔖 Salvati",
    tabFriends:       "👥 Amici",
    tabLeaderboard:   "🏆 Classifica",
    // Leaderboard
    leaderboardTitle: "🏆 Classifica Settimanale",
    leaderboardSub:   "Top 10 utenti per like ricevuti questa settimana",
    leaderboardEmpty: "Nessun dato disponibile ancora.",
    // Achievements
    achievementsLabel:"🏆 Achievement",
    achievementLocked:"Bloccato",
    achievementsBtn:  "🏆 Achievement",
    achievementsTitle:"I tuoi Achievement",
    achievementsAll:  "Tutti",
    achievementsUnlocked: "Sbloccati",
    achievementsLocked:   "Bloccati",
    // Clan
    clanTitle:        "🏰 Il tuo Clan",
    clanNone:         "Non sei in nessun clan.",
    clanCreate:       "Crea Clan",
    clanJoin:         "Unisciti a un Clan",
    clanLeave:        "Lascia il Clan",
    clanMembers:      "Membri",
    clanSearch:       "Cerca clan...",
    clanNameLabel:    "Nome clan",
    clanTagLabel:     "Tag (2-5 caratteri)",
    clanTagTooltip:   "Il tag è una sigla corta che identifica il clan (es. HU, WOLF, SW). Apparirà accanto al tuo nome in tutto il sito.",
    clanDescLabel:    "Descrizione (opzionale)",
    clanCreateBtn:    "Crea",
    clanJoinBtn:      "Unisciti",
    clanLeader:       "👑 Leader",
    clanEdit:         "✏️ Modifica Clan",
    clanChat:         "💬 Chat",
    clanChatPlaceholder: "Scrivi un messaggio...",
    clanNoMessages:   "Nessun messaggio ancora. Sii il primo!",
    // Traduttore contenuti
    translateUI:      "Traduci Interfaccia",
    translateContent: "Traduci Contenuti Players",
    translateSettings:"⚙️ Impostazioni Traduzione",
    translateBtn:     "Traduci",
    translating:      "Traduzione...",
    showOriginal:     "Originale",
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
