/**
 * NODE.JS SINGLE-FILE BOT HOSTING PANEL (dev by blaxkmira)
 * -----------------------------------------------------
 * 1. Save as admin_panel.js
 * 2. Run: node admin_panel.js
 * 3. Open http://localhost:3000
 * 4. Login: Mira / Nika
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const crypto = require('crypto');

// --- CONFIGURATION ---
const PORT = 3000;
const ADMIN_USERNAME = 'Mira';
const ADMIN_PASSWORD = 'Nika';
const BOTS_DIR = path.join(__dirname, 'bots');
const DB_SERVERS = path.join(__dirname, 'servers.json');
const DB_USERS = path.join(__dirname, 'users.json');

// --- GLOBAL STATE ---
let servers = {};
let users = {};
let sessions = {};
let processes = {};
let logs = [];
const MAX_LOGS = 300;

// --- INITIALIZATION & MIGRATION ---
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR);

function loadData() {
    // Load Servers
    if (fs.existsSync(DB_SERVERS)) {
        try {
            const rawData = fs.readFileSync(DB_SERVERS, 'utf8');
            servers = JSON.parse(rawData);
            
            // MIGRATION: Move old single files to folders
            for (const id in servers) {
                const oldPath = path.join(BOTS_DIR, `${id}.js`);
                const newFolder = path.join(BOTS_DIR, id);
                const newPath = path.join(newFolder, 'index.js');

                if (fs.existsSync(oldPath)) {
                    console.log(`Migrating server ${id} to folder structure...`);
                    if (!fs.existsSync(newFolder)) fs.mkdirSync(newFolder);
                    fs.renameSync(oldPath, newPath);
                } else if (!fs.existsSync(newFolder)) {
                    // Create folder if missing entirely
                    fs.mkdirSync(newFolder);
                    fs.writeFileSync(newPath, '// Bot file missing, recreated.');
                }

                // Reset status on boot
                servers[id].status = 'stopped';
                servers[id].pid = null;
            }
        } catch (e) { 
            console.error("CRITICAL: servers.json is corrupted.", e.message);
            console.log("Backing up servers.json to servers.json.bak and resetting database.");
            try { fs.copyFileSync(DB_SERVERS, DB_SERVERS + '.bak'); } catch(err) {}
            servers = {}; 
        }
    }
    
    // Load Users
    if (fs.existsSync(DB_USERS)) {
        try { 
            users = JSON.parse(fs.readFileSync(DB_USERS, 'utf8')); 
        } catch (e) { 
            console.error("CRITICAL: users.json is corrupted.", e.message);
            console.log("Backing up users.json to users.json.bak and resetting users.");
            try { fs.copyFileSync(DB_USERS, DB_USERS + '.bak'); } catch(err) {}
            users = {}; 
        }
    }

    if (Object.keys(users).length === 0) {
        users[ADMIN_USERNAME] = { password: ADMIN_PASSWORD, role: 'admin' };
        saveUsers();
    }
}

function saveServers() {
    try {
        const toSave = {};
        for(const id in servers) {
            const s = { ...servers[id] };
            delete s.pid;
            delete s.status;
            toSave[id] = s;
        }
        fs.writeFileSync(DB_SERVERS, JSON.stringify(toSave, null, 2));
    } catch(e) { console.error("Err saving servers", e); }
}

function saveUsers() {
    try { fs.writeFileSync(DB_USERS, JSON.stringify(users, null, 2)); }
    catch(e) { console.error("Err saving users", e); }
}

// --- TEMPLATES ---
const TEMPLATES = {
    discord: `
const { Client, GatewayIntentBits } = require('discord.js');
let client;
try {
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
} catch(e) {
    client = { login: (t) => console.log("Virtual Login: " + t), on: () => {} };
}
client.on('ready', () => console.log(\`Logged in as \${client.user?.tag || 'VirtualBot'}!\`));
console.log("Starting Discord Bot...");
client.login(process.env.BOT_TOKEN);
setInterval(() => {}, 10000);
`,
    telegram: `
const TelegramBot = require('node-telegram-bot-api');
let bot;
try {
    bot = new TelegramBot(process.env.BOT_TOKEN, {polling: true});
} catch(e) {
    bot = { on: () => {} };
}
console.log("Telegram Bot Polling...");
bot.on('message', (msg) => console.log("Msg from " + msg.chat.id));
setInterval(() => {}, 10000);
`,
    node: `
console.log("Starting Node Process...");
let i = 0;
setInterval(() => console.log("Tick " + i++), 5000);
`
};

loadData();

function addLog(serverId, type, message) {
    const timestamp = new Date().toLocaleTimeString();
    const serverName = servers[serverId] ? servers[serverId].name : 'SYSTEM';
    const logEntry = { id: Date.now() + Math.random(), serverId, serverName, type, message, timestamp };
    logs.push(logEntry);
    if (logs.length > MAX_LOGS) logs.shift();
}

// --- HTML FRONTEND ---
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nexus Cloud Control</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Rajdhani:wght@500;600;700&display=swap');
        body { font-family: 'Rajdhani', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        .bg-grid { background-image: linear-gradient(rgba(15, 23, 42, 0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.9) 1px, transparent 1px); background-size: 20px 20px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .status-online { background-color: #10b981; box-shadow: 0 0 10px #10b981; animation: pulse 2s infinite; }
        .status-offline { background-color: #ef4444; box-shadow: 0 0 5px #ef4444; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
        .modal-anim { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
    </style>
</head>
<body class="bg-slate-950 text-slate-200 h-screen overflow-hidden flex flex-col bg-grid">
    
    <!-- AUTH MODAL -->
    <div id="login-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md">
        <div class="bg-slate-900 p-8 rounded-2xl border border-cyan-500/30 w-full max-w-md shadow-2xl relative overflow-hidden">
            <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-purple-500"></div>
            <div class="text-center mb-8">
                <i class="fa-solid fa-server text-4xl text-cyan-400 mb-2"></i>
                <h1 class="text-3xl font-bold text-white tracking-widest">NEXUS<span class="text-cyan-400">CLOUD</span></h1>
            </div>
            <form id="login-form" class="space-y-4">
                <input type="text" id="username" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-cyan-400 focus:border-cyan-500 focus:outline-none transition-all font-mono tracking-widest" placeholder="USERNAME">
                <input type="password" id="password" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-cyan-400 focus:border-cyan-500 focus:outline-none transition-all font-mono tracking-widest" placeholder="PASSWORD">
                <button type="submit" class="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded-lg transition-all shadow-lg hover:shadow-cyan-500/20 tracking-wider">INITIALIZE SESSION</button>
            </form>
            <p id="login-error" class="text-rose-500 text-center mt-4 text-sm hidden font-mono">_INVALID_CREDENTIALS</p>
        </div>
    </div>

    <!-- MAIN APP -->
    <div id="app-content" class="flex-1 flex hidden">
        <!-- SIDEBAR -->
        <aside class="w-64 bg-slate-900/80 backdrop-blur border-r border-slate-800 flex flex-col z-20">
            <div class="p-6 border-b border-slate-800">
                <h2 class="text-2xl font-bold flex items-center gap-2 text-white">
                    <i class="fa-solid fa-network-wired text-cyan-400"></i> NEXUS
                </h2>
                <div class="flex justify-between items-center mt-2">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        <span class="text-xs text-emerald-500 font-mono">ONLINE</span>
                    </div>
                    <div class="flex flex-col items-end">
                        <span id="current-user" class="text-xs text-white font-bold uppercase"></span>
                        <span id="current-role" class="text-[10px] text-slate-500 font-mono border border-slate-700 rounded px-1 uppercase"></span>
                    </div>
                </div>
            </div>
            
            <nav class="flex-1 p-4 space-y-2">
                <button onclick="setView('instances')" class="nav-btn w-full text-left p-3 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-cyan-400 transition-all flex items-center gap-3 active-nav" id="nav-instances">
                    <i class="fa-solid fa-server w-6 text-center"></i> INSTANCES
                </button>
                <button onclick="setView('editor')" class="nav-btn w-full text-left p-3 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-purple-400 transition-all flex items-center gap-3" id="nav-editor">
                    <i class="fa-solid fa-folder-tree w-6 text-center"></i> FILE MANAGER
                </button>
                <button onclick="setView('logs')" class="nav-btn w-full text-left p-3 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-emerald-400 transition-all flex items-center gap-3" id="nav-logs">
                    <i class="fa-solid fa-terminal w-6 text-center"></i> CONSOLE
                </button>
                <button onclick="setView('terminal')" class="nav-btn w-full text-left p-3 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-pink-400 transition-all flex items-center gap-3" id="nav-terminal">
                    <i class="fa-solid fa-keyboard w-6 text-center"></i> TERMINAL
                </button>
                <div class="h-px bg-slate-800 my-2 admin-only hidden"></div>
                <button onclick="setView('users')" class="nav-btn admin-only hidden w-full text-left p-3 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-amber-400 transition-all flex items-center gap-3" id="nav-users">
                    <i class="fa-solid fa-users w-6 text-center"></i> USERS
                </button>
            </nav>
            <div class="p-4 border-t border-slate-800 space-y-2">
                <button onclick="logout()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-400 py-2 rounded text-sm transition-colors">LOGOUT</button>
                <button onclick="shutdownSystem()" class="admin-only hidden w-full bg-rose-900/20 hover:bg-rose-900/40 text-rose-500 py-2 rounded text-sm transition-colors border border-rose-900/30 flex items-center justify-center gap-2">
                    <i class="fa-solid fa-power-off"></i> SHUTDOWN
                </button>
            </div>
        </aside>

        <!-- MAIN CONTENT -->
        <main class="flex-1 flex flex-col relative overflow-hidden bg-slate-950/50">
            
            <!-- VIEW: INSTANCES -->
            <div id="view-instances" class="view-section absolute inset-0 p-8 overflow-y-auto">
                <div class="flex justify-between items-center mb-8">
                    <div>
                        <h1 class="text-3xl font-bold text-white mb-1">Server Instances</h1>
                        <p class="text-slate-400 text-sm">Manage Discord, Telegram, and Node.js containers.</p>
                    </div>
                    <button onclick="openModal('server')" id="btn-create-server" class="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-cyan-500/20 transition-all flex items-center gap-2">
                        <i class="fa-solid fa-plus"></i> NEW SERVER
                    </button>
                </div>
                <div id="server-limit-msg" class="hidden bg-rose-900/20 border border-rose-900 text-rose-400 p-3 rounded mb-4 text-sm text-center">
                    <i class="fa-solid fa-lock mr-2"></i> Free Plan Limit Reached (1 Server Max).
                </div>
                <div id="server-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"></div>
            </div>

            <!-- VIEW: EDITOR (FILE MANAGER) -->
            <div id="view-editor" class="view-section absolute inset-0 hidden flex flex-col">
                <!-- Toolbar -->
                <div class="flex justify-between items-center bg-slate-900 p-3 border-b border-slate-800">
                    <div class="flex items-center gap-4">
                        <div class="flex flex-col">
                            <label class="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Select Server</label>
                            <select id="fm-server-select" onchange="fmLoadFiles()" class="bg-slate-950 border border-slate-700 text-white text-sm rounded p-2 pr-8 focus:outline-none focus:border-purple-500 min-w-[200px]">
                                <option value="" disabled selected>-- Select Server --</option>
                            </select>
                        </div>
                        <div id="fm-actions" class="hidden flex gap-2 items-end h-full pt-4">
                            <button onclick="document.getElementById('upload-input').click()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-sm transition-colors border border-slate-700">
                                <i class="fa-solid fa-upload mr-1"></i> Upload
                            </button>
                            <button onclick="fmCreateFile()" class="bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded text-sm transition-colors border border-slate-700">
                                <i class="fa-solid fa-plus mr-1"></i> New File
                            </button>
                            <button onclick="fmDeleteFile()" class="bg-slate-800 hover:bg-rose-900/50 text-rose-400 px-3 py-1.5 rounded text-sm transition-colors border border-slate-700">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                            <input type="file" id="upload-input" class="hidden" onchange="fmUpload(this)">
                        </div>
                    </div>
                    <div class="flex gap-2 pt-4">
                        <button onclick="fmSaveFile()" class="bg-purple-600 hover:bg-purple-500 text-white px-6 py-1.5 rounded shadow-lg transition-colors text-sm"><i class="fa-solid fa-save mr-2"></i>SAVE</button>
                    </div>
                </div>

                <!-- FM Body -->
                <div class="flex-1 flex overflow-hidden">
                    <!-- File List -->
                    <div class="w-64 bg-slate-900/50 border-r border-slate-800 overflow-y-auto">
                        <div id="file-list" class="p-2 space-y-1">
                            <div class="text-slate-500 text-xs p-2 italic">Select a server to view files</div>
                        </div>
                    </div>
                    <!-- Editor -->
                    <div class="flex-1 bg-slate-900 relative">
                        <div id="editor-overlay" class="absolute inset-0 bg-slate-950/50 z-10 flex items-center justify-center text-slate-500 text-sm">
                            Select a file to edit
                        </div>
                        <textarea id="file-content" class="code-editor w-full h-full bg-slate-900 text-slate-300 p-6 resize-none focus:outline-none font-mono text-sm leading-relaxed" spellcheck="false"></textarea>
                    </div>
                </div>
            </div>

            <!-- VIEW: LOGS -->
            <div id="view-logs" class="view-section absolute inset-0 p-6 hidden flex flex-col">
                <div class="bg-slate-900 border border-slate-800 rounded-t-lg p-3 flex justify-between items-center">
                    <span class="text-sm font-mono text-slate-400">System Logs</span>
                    <button onclick="clearLogs()" class="text-xs text-slate-500 hover:text-white"><i class="fa-solid fa-eraser"></i> CLEAR</button>
                </div>
                <div id="log-container" class="flex-1 bg-black border border-slate-800 border-t-0 rounded-b-lg p-4 overflow-y-auto font-mono text-sm space-y-1"></div>
            </div>

            <!-- VIEW: TERMINAL -->
            <div id="view-terminal" class="view-section absolute inset-0 p-6 hidden flex flex-col">
                 <div class="bg-slate-900 border border-slate-800 rounded-t-lg p-3 flex justify-between items-center">
                    <span class="text-sm font-mono text-pink-400"><i class="fa-solid fa-terminal mr-2"></i>Web Terminal</span>
                    <span class="text-xs text-slate-500" id="term-subtitle">Restricted Shell</span>
                </div>
                <div class="flex-1 bg-black border border-slate-800 border-t-0 rounded-b-lg p-4 font-mono text-sm overflow-y-auto" id="term-output">
                    <div class="text-slate-500 mb-2">Nexus Terminal v2.0.0</div>
                    <div class="text-slate-500 mb-4" id="term-welcome"></div>
                </div>
                <form id="term-form" class="mt-2 flex gap-2 bg-slate-900 p-2 rounded border border-slate-800">
                    <span class="text-emerald-500 font-mono py-1 select-none" id="term-prompt">user@nexus:~#</span>
                    <input type="text" id="term-input" class="flex-1 bg-transparent outline-none text-white font-mono" autocomplete="off" autofocus placeholder="Enter command...">
                </form>
            </div>

            <!-- VIEW: USERS -->
            <div id="view-users" class="view-section absolute inset-0 p-8 overflow-y-auto hidden">
                <div class="flex justify-between items-center mb-8">
                    <div>
                        <h1 class="text-3xl font-bold text-white mb-1">User Management</h1>
                    </div>
                    <button onclick="openUserModal()" class="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2 rounded-lg shadow-lg hover:shadow-amber-500/20 transition-all flex items-center gap-2">
                        <i class="fa-solid fa-user-plus"></i> ADD USER
                    </button>
                </div>
                <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                    <table class="w-full text-left">
                        <tbody id="user-list" class="divide-y divide-slate-800 text-slate-300"></tbody>
                    </table>
                </div>
            </div>
        </main>
    </div>

    <!-- SERVER MODAL -->
    <div id="server-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm hidden">
        <div class="bg-slate-900 p-6 rounded-xl border border-slate-700 w-full max-w-lg shadow-2xl transform transition-all scale-95 opacity-0 modal-anim">
            <h3 id="modal-title" class="text-xl font-bold text-white mb-6 border-b border-slate-800 pb-2">PROVISION INSTANCE</h3>
            <form id="server-form" class="space-y-4">
                <input type="hidden" id="server-id">
                <div class="grid grid-cols-2 gap-4">
                    <div class="col-span-2">
                        <label class="block text-xs text-slate-500 uppercase mb-1">Server Name</label>
                        <input type="text" id="s-name" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white focus:border-cyan-500 focus:outline-none" required>
                    </div>
                    <div class="col-span-2">
                         <label class="block text-xs text-slate-500 uppercase mb-1">Bot Type</label>
                         <div class="grid grid-cols-3 gap-2">
                             <label class="cursor-pointer">
                                 <input type="radio" name="s-type" value="discord" class="peer sr-only" required>
                                 <div class="p-2 rounded border border-slate-700 bg-slate-950 peer-checked:border-indigo-500 peer-checked:bg-indigo-500/20 hover:bg-slate-800 flex flex-col items-center gap-1 transition-all">
                                     <i class="fa-brands fa-discord text-xl text-indigo-400"></i><span class="text-[10px]">Discord</span>
                                 </div>
                             </label>
                             <label class="cursor-pointer">
                                 <input type="radio" name="s-type" value="telegram" class="peer sr-only">
                                 <div class="p-2 rounded border border-slate-700 bg-slate-950 peer-checked:border-sky-500 peer-checked:bg-sky-500/20 hover:bg-slate-800 flex flex-col items-center gap-1 transition-all">
                                     <i class="fa-brands fa-telegram text-xl text-sky-400"></i><span class="text-[10px]">Telegram</span>
                                 </div>
                             </label>
                             <label class="cursor-pointer">
                                 <input type="radio" name="s-type" value="node" class="peer sr-only">
                                 <div class="p-2 rounded border border-slate-700 bg-slate-950 peer-checked:border-green-500 peer-checked:bg-green-500/20 hover:bg-slate-800 flex flex-col items-center gap-1 transition-all">
                                     <i class="fa-brands fa-node text-xl text-green-400"></i><span class="text-[10px]">NodeJS</span>
                                 </div>
                             </label>
                         </div>
                    </div>
                    <div id="admin-options" class="contents">
                        <div><label class="block text-xs text-slate-500 uppercase mb-1">RAM</label><select id="s-ram" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"><option value="512MB">512MB</option><option value="1GB">1GB</option></select></div>
                        <div><label class="block text-xs text-slate-500 uppercase mb-1">Storage</label><select id="s-storage" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"><option value="10GB">10GB</option></select></div>
                    </div>
                    <div id="user-options-msg" class="col-span-2 hidden text-xs text-slate-500 italic text-center p-2 border border-slate-800 rounded bg-slate-900">Restricted Plan: 250MB RAM / 1GB Storage Locked</div>
                </div>
                <div><label class="block text-xs text-slate-500 uppercase mb-1">BOT TOKEN</label><input type="text" id="s-env" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white font-mono text-xs"></div>
                <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
                    <button type="button" onclick="closeModal('server')" class="px-4 py-2 text-slate-400 hover:text-white">Cancel</button>
                    <button type="submit" class="bg-cyan-600 hover:bg-cyan-500 text-white px-6 py-2 rounded shadow-lg">Provision</button>
                </div>
            </form>
        </div>
    </div>

    <!-- USER MODAL -->
    <div id="user-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm hidden">
        <div class="bg-slate-900 p-6 rounded-xl border border-slate-700 w-full max-w-sm shadow-2xl transform transition-all scale-95 opacity-0 modal-anim">
            <h3 class="text-xl font-bold text-white mb-6 border-b border-slate-800 pb-2">CREATE USER</h3>
            <form id="user-form" class="space-y-4">
                <div><label class="block text-xs text-slate-500 uppercase mb-1">Username</label><input type="text" id="u-username" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white" required></div>
                <div><label class="block text-xs text-slate-500 uppercase mb-1">Password</label><input type="password" id="u-password" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white" required></div>
                <div><label class="block text-xs text-slate-500 uppercase mb-1">Role</label><select id="u-role" class="w-full bg-slate-950 border border-slate-700 rounded p-2 text-white"><option value="user">User</option><option value="admin">Admin</option></select></div>
                <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800"><button type="button" onclick="closeModal('user')" class="px-4 py-2 text-slate-400 hover:text-white">Cancel</button><button type="submit" class="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2 rounded shadow-lg">Create</button></div>
            </form>
        </div>
    </div>

    <script>
        let currentUser = null;
        let currentRole = null;
        let activeFile = null;

        const API = {
            login: async (u, p) => { const r = await fetch('/auth', { method: 'POST', body: JSON.stringify({ username:u, password:p }) }); if(!r.ok) throw new Error(); return await r.json(); },
            logout: async () => fetch('/auth', { method: 'DELETE' }),
            shutdown: async () => fetch('/api/shutdown', { method: 'POST' }),
            // IMPROVED: Now checks for errors
            manageServer: async (m, d) => {
                const res = await fetch('/api/servers', { 
                    method: m, 
                    headers: { 'Content-Type': 'application/json' }, // Added Header
                    body: JSON.stringify(d) 
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Server Error');
                }
                return res.json();
            },
            getServers: async () => (await fetch('/api/servers')).json(),
            deleteServer: async (id) => fetch('/api/servers/'+id, { method: 'DELETE' }),
            control: async (id, act) => fetch('/api/control', { method: 'POST', body: JSON.stringify({ id, action: act }) }),
            getUsers: async () => (await fetch('/api/users')).json(),
            createUser: async (d) => fetch('/api/users', { method: 'POST', body: JSON.stringify(d) }),
            deleteUser: async (u) => fetch('/api/users/'+u, { method: 'DELETE' }),
            getLogs: async () => (await fetch('/api/logs')).json(),
            executeTerm: async (cmd) => (await fetch('/api/terminal', { method: 'POST', body: JSON.stringify({ command: cmd }) })).json(),
            listFiles: async (sid) => (await fetch(\`/api/files/list?serverId=\${sid}\`)).json(),
            readFile: async (sid, f) => (await fetch(\`/api/files/read?serverId=\${sid}&file=\${f}\`)).text(),
            writeFile: async (sid, f, c) => fetch(\`/api/files/write?serverId=\${sid}\`, { method: 'POST', body: JSON.stringify({ serverId:sid, file:f, content:c }) }),
            deleteFile: async (sid, f) => fetch(\`/api/files/delete?serverId=\${sid}&file=\${f}\`, { method: 'DELETE' }),
        };

        // --- AUTH & UI ---
        document.getElementById('login-form').onsubmit = async (e) => {
            e.preventDefault();
            try {
                const res = await API.login(document.getElementById('username').value, document.getElementById('password').value);
                currentUser = res.username; currentRole = res.role;
                updateUIForRole();
                document.getElementById('login-modal').classList.add('hidden');
                document.getElementById('app-content').classList.remove('hidden');
                init();
            } catch { document.getElementById('login-error').classList.remove('hidden'); }
        };

        function updateUIForRole() {
            document.getElementById('current-user').innerText = currentUser;
            document.getElementById('current-role').innerText = currentRole;
            if (currentRole === 'admin') {
                document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
                document.getElementById('term-prompt').innerText = 'root@nexus:~#';
                document.getElementById('term-welcome').innerText = 'Full Root Access Granted.';
            } else {
                document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
                document.getElementById('term-prompt').innerText = currentUser + '@nexus:~$';
                document.getElementById('term-welcome').innerText = 'Restricted Shell. Allowed: npm install <package>';
            }
        }

        async function logout() { await API.logout(); location.reload(); }
        async function shutdownSystem() { if(confirm('SHUT DOWN SYSTEM?')) { try { await API.shutdown(); } catch{} document.body.innerHTML = '<div class="flex h-screen w-full items-center justify-center bg-black text-rose-500 font-mono text-xl">SYSTEM HALTED</div>'; } }

        function init() {
            renderServers();
            if(currentRole === 'admin') renderUsers();
            populateFMSelect();
            setInterval(() => {
                if(!document.getElementById('view-instances').classList.contains('hidden')) API.getServers().then(renderGrid);
                if(!document.getElementById('view-logs').classList.contains('hidden')) renderLogs();
            }, 2000);
        }

        function setView(view) {
            document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
            document.getElementById('view-' + view).classList.remove('hidden');
            document.querySelectorAll('.nav-btn').forEach(b => {
                b.classList.remove('bg-slate-800', 'text-cyan-400', 'text-purple-400', 'text-amber-400', 'text-pink-400');
                b.classList.add('text-slate-400');
            });
            document.getElementById('nav-' + view).classList.add('bg-slate-800', view==='editor'?'text-purple-400':view==='users'?'text-amber-400':view==='terminal'?'text-pink-400':'text-cyan-400');
            document.getElementById('nav-' + view).classList.remove('text-slate-400');
            if(view==='instances') renderServers();
            if(view==='users' && currentRole === 'admin') renderUsers();
        }

        // --- INSTANCES ---
        async function renderServers() {
            const list = await API.getServers();
            renderGrid(list);
            populateFMSelect(list);
            const count = Object.values(list).filter(s => s.owner === currentUser).length;
            if (currentRole !== 'admin' && count >= 1) {
                document.getElementById('btn-create-server').classList.add('hidden');
                document.getElementById('server-limit-msg').classList.remove('hidden');
            } else {
                document.getElementById('btn-create-server').classList.remove('hidden');
                document.getElementById('server-limit-msg').classList.add('hidden');
            }
        }

        function renderGrid(list) {
            const grid = document.getElementById('server-grid');
            grid.innerHTML = '';
            Object.values(list).forEach(s => {
                if (currentRole !== 'admin' && s.owner !== currentUser) return;
                const isRun = s.status === 'running';
                const card = document.createElement('div');
                card.className = \`bg-slate-900 border \${isRun ? 'border-emerald-500/30' : 'border-slate-800'} rounded-xl p-6 relative overflow-hidden group hover:border-slate-600 transition-all\`;
                card.innerHTML = \`<div class="flex justify-between items-start mb-4 relative z-10"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded bg-slate-800 flex items-center justify-center text-xl"><i class="fa-solid fa-server text-cyan-400"></i></div><div><h3 class="font-bold text-white">\${s.name}</h3><div class="flex items-center gap-2 text-xs"><span class="status-dot \${isRun ? 'status-online' : 'status-offline'}"></span><span class="\${isRun ? 'text-emerald-500' : 'text-slate-500'}">\${isRun ? 'RUNNING' : 'STOPPED'}</span></div></div></div><div class="flex gap-1"><button onclick="deleteServer('\${s.id}')" class="w-8 h-8 rounded bg-slate-800 text-slate-400 hover:text-rose-500 transition-colors"><i class="fa-solid fa-trash"></i></button></div></div><div class="text-xs text-slate-500 font-mono mb-4 bg-slate-950 p-2 rounded">Owner: \${s.owner}<br>RAM: \${s.ram}<br>ID: \${s.id}</div><button onclick="control('\${s.id}', '\${isRun ? 'stop' : 'start'}')" class="w-full py-2 rounded font-bold text-sm transition-all \${isRun ? 'bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white' : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white'}">\${isRun ? 'STOP SERVER' : 'START SERVER'}</button>\`;
                grid.appendChild(card);
            });
        }

        // --- FILE MANAGER ---
        async function populateFMSelect(list) {
            if(!list) list = await API.getServers();
            const sel = document.getElementById('fm-server-select');
            const current = sel.value;
            sel.innerHTML = '<option value="" disabled selected>-- Select Server --</option>';
            Object.values(list).forEach(s => {
                if (currentRole !== 'admin' && s.owner !== currentUser) return;
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.innerText = \`\${s.name} (\${s.type})\`;
                sel.appendChild(opt);
            });
            if(current) sel.value = current;
        }

        async function fmLoadFiles() {
            const sid = document.getElementById('fm-server-select').value;
            if(!sid) return;
            document.getElementById('fm-actions').classList.remove('hidden');
            const files = await API.listFiles(sid);
            const listEl = document.getElementById('file-list');
            listEl.innerHTML = '';
            files.forEach(f => {
                const div = document.createElement('div');
                div.className = 'text-sm p-2 rounded cursor-pointer hover:bg-slate-800 text-slate-300 flex items-center gap-2 transition-colors ' + (activeFile && activeFile.path === f ? 'bg-slate-800 text-cyan-400' : '');
                div.innerHTML = \`<i class="fa-regular fa-file"></i> \${f}\`;
                div.onclick = () => fmSelectFile(sid, f);
                listEl.appendChild(div);
            });
        }

        async function fmSelectFile(sid, file) {
            activeFile = { serverId: sid, path: file };
            document.getElementById('editor-overlay').classList.add('hidden');
            const content = await API.readFile(sid, file);
            document.getElementById('file-content').value = content;
            fmLoadFiles();
        }

        async function fmSaveFile() {
            if(!activeFile) return alert("Select a file first");
            const c = document.getElementById('file-content').value;
            await API.writeFile(activeFile.serverId, activeFile.path, c);
            const btn = event.currentTarget;
            const og = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> SAVED';
            setTimeout(() => btn.innerHTML = og, 1500);
        }

        async function fmCreateFile() {
            const sid = document.getElementById('fm-server-select').value;
            if(!sid) return alert("Select a server first");
            const name = prompt("File name (e.g., config.json):");
            if(name) {
                await API.writeFile(sid, name, "// New file");
                fmLoadFiles();
                fmSelectFile(sid, name);
            }
        }

        async function fmDeleteFile() {
            if(!activeFile) return alert("Select a file first");
            if(confirm(\`Delete \${activeFile.path}?\`)) {
                await API.deleteFile(activeFile.serverId, activeFile.path);
                activeFile = null;
                document.getElementById('file-content').value = '';
                document.getElementById('editor-overlay').classList.remove('hidden');
                fmLoadFiles();
            }
        }

        async function fmUpload(input) {
            const sid = document.getElementById('fm-server-select').value;
            if(!sid || !input.files[0]) return;
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = async (e) => {
                await API.writeFile(sid, file.name, e.target.result);
                fmLoadFiles();
                fmSelectFile(sid, file.name);
            };
            reader.readAsText(file);
            input.value = '';
        }

        // --- IMPROVED FORM HANDLER ---
        document.getElementById('server-form').onsubmit = async (e) => { 
            e.preventDefault(); 
            const typeEl = document.querySelector('input[name="s-type"]:checked');
            if (!typeEl) return alert("Please select a Bot Type (Discord/Telegram/Node).");
            
            const data = { 
                name: document.getElementById('s-name').value, 
                type: typeEl.value, 
                ram: document.getElementById('s-ram').value, 
                storage: document.getElementById('s-storage').value, 
                env: document.getElementById('s-env').value 
            };

            try { 
                await API.manageServer('POST', data); 
                closeModal('server'); 
                renderServers(); 
            } catch (err) { 
                alert("Error: " + err.message); 
            } 
        };

        document.getElementById('user-form').onsubmit = async (e) => { e.preventDefault(); await API.createUser({ username: document.getElementById('u-username').value, password: document.getElementById('u-password').value, role: document.getElementById('u-role').value }); closeModal('user'); renderUsers(); };
        async function deleteServer(id) { if(confirm('Delete?')) await API.deleteServer(id); renderServers(); }
        async function deleteUser(u) { if(confirm('Delete?')) await API.deleteUser(u); renderUsers(); }
        async function control(id, action) { await API.control(id, action); renderServers(); }
        
        const ADMIN_USERNAME = "${ADMIN_USERNAME}";
        async function renderUsers() { const l = await API.getUsers(); document.getElementById('user-list').innerHTML = Object.keys(l).map(u => \`<tr><td class="p-4 text-white">\${u}</td><td class="p-4">\${l[u].role}</td><td class="p-4 text-right">\${u!==ADMIN_USERNAME?\`<button onclick="deleteUser('\${u}')" class="text-rose-500"><i class="fa-solid fa-trash"></i></button>\`:''}</td></tr>\`).join(''); }
        
        const termInput = document.getElementById('term-input');
        const termOutput = document.getElementById('term-output');
        document.getElementById('term-form').onsubmit = async (e) => { e.preventDefault(); const c = termInput.value.trim(); if(!c) return; appendTerm(c, 'text-emerald-500', true); termInput.value = ''; if(c==='clear'){termOutput.innerHTML='';return;} try { const r = await API.executeTerm(c); if(r.error) appendTerm(r.error, 'text-rose-500'); else appendTerm(r.output, 'text-slate-300'); } catch { appendTerm("Error", 'text-rose-500'); } };
        function appendTerm(t, c, isCmd) { const d = document.createElement('div'); d.className = c + ' mb-1 whitespace-pre-wrap'; d.innerText = (isCmd ? (currentRole==='admin'?'root@nexus:~# ':'user@nexus:~$ ') : '') + t; termOutput.appendChild(d); termOutput.scrollTop = termOutput.scrollHeight; }
        
        let lastLogId = 0;
        async function renderLogs() { const logs = await API.getLogs(); const div = document.getElementById('log-container'); logs.forEach(l => { if(l.id>lastLogId) { if(currentRole!=='admin' && servers[l.serverId]?.owner !== currentUser) return; const el = document.createElement('div'); el.className='font-mono text-xs hover:bg-white/5 p-1 rounded text-slate-300'; el.innerHTML = \`<span class="opacity-50">[\${l.timestamp}]</span> <span class="text-purple-400">\${l.serverName}:</span> \${l.message}\`; div.appendChild(el); lastLogId=l.id; div.scrollTop=div.scrollHeight; }}); }
        function clearLogs() { document.getElementById('log-container').innerHTML = ''; }
        
        function openModal(t) { const m = document.getElementById(t + '-modal'); m.classList.remove('hidden'); setTimeout(()=>m.querySelector('div').classList.remove('opacity-0', 'scale-95'), 10); if(currentRole!=='admin') { document.getElementById('admin-options')?.classList.add('hidden'); document.getElementById('user-options-msg')?.classList.remove('hidden'); } else { document.getElementById('admin-options')?.classList.remove('hidden'); document.getElementById('user-options-msg')?.classList.add('hidden'); } }
        function openUserModal() { const m = document.getElementById('user-modal'); m.classList.remove('hidden'); setTimeout(()=>m.querySelector('div').classList.remove('opacity-0', 'scale-95'), 10); }
        function closeModal(t) { const m = document.getElementById(t + '-modal'); m.querySelector('div').classList.add('opacity-0', 'scale-95'); setTimeout(()=>m.classList.add('hidden'), 300); }
    </script>
</body>
</html>
`;

// --- SERVER HANDLERS ---
const server = http.createServer(async (req, res) => {
    const getBody = async () => new Promise(r => { let b=''; req.on('data', c=>b+=c); req.on('end', ()=>r(b)); });
    const json = (d, c=200) => { res.writeHead(c, {'Content-Type':'application/json'}); res.end(JSON.stringify(d)); };
    const getQuery = (p) => new URL('http://z'+req.url).searchParams.get(p);

    const cookie = req.headers.cookie || '';
    let currentUser = null; 
    for(const k in sessions) { if(cookie.includes(`session=${k}`)) currentUser = sessions[k]; }

    if(req.url === '/' && req.method === 'GET') { res.writeHead(200,{'Content-Type':'text/html'}); res.end(HTML_CONTENT); return; }
    if(req.url === '/auth' && req.method === 'POST') {
        const creds = JSON.parse(await getBody());
        const u = users[creds.username];
        if(u && u.password === creds.password) {
            const sessId = crypto.randomBytes(16).toString('hex');
            sessions[sessId] = { username: creds.username, role: u.role };
            res.writeHead(200, { 'Set-Cookie': `session=${sessId}; HttpOnly; Path=/`, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ username: creds.username, role: u.role }));
        } else json({error:'Invalid'}, 401);
        return;
    }

    if(!currentUser) { json({error:'Unauthorized'}, 401); return; }
    if(req.url === '/auth' && req.method === 'DELETE') { json({ok:true}); return; }
    if(req.url === '/api/shutdown' && req.method === 'POST') { if(currentUser.role !== 'admin') return json({error:403}, 403); res.end('{}'); setTimeout(() => process.exit(0), 100); return; }

    // --- FILE API ---
    if(req.url.startsWith('/api/files/')) {
        const sid = getQuery('serverId');
        const s = servers[sid];
        if (!s || (currentUser.role !== 'admin' && s.owner !== currentUser.username)) return json({error:403}, 403);
        
        const folder = path.join(BOTS_DIR, sid);
        if(!fs.existsSync(folder)) fs.mkdirSync(folder);

        if(req.url.includes('/list')) {
            const files = fs.readdirSync(folder).filter(f => !f.startsWith('.')); // hide hidden
            json(files);
            return;
        }
        if(req.url.includes('/read')) {
            const f = getQuery('file');
            const fp = path.join(folder, path.basename(f));
            if(fs.existsSync(fp)) res.end(fs.readFileSync(fp)); else res.end('');
            return;
        }
        if(req.url.includes('/delete') && req.method === 'DELETE') {
            const f = getQuery('file');
            try { fs.unlinkSync(path.join(folder, path.basename(f))); json({ok:1}); } catch(e){ json({error:e.message}); }
            return;
        }
        if(req.url.includes('/write') && req.method === 'POST') {
            const b = JSON.parse(await getBody());
            if(b.serverId !== sid) return json({error:400});
            try { fs.writeFileSync(path.join(folder, path.basename(b.file)), b.content); json({ok:1}); } catch(e){ json({error:e.message}); }
            return;
        }
    }

    // --- SERVER API ---
    if(req.url === '/api/servers') {
        if(req.method === 'GET') {
            if (currentUser.role === 'admin') json(servers);
            else { const userServers = {}; for(const id in servers) { if (servers[id].owner === currentUser.username) userServers[id] = servers[id]; } json(userServers); }
            return;
        }
        if(req.method === 'POST') {
            const b = JSON.parse(await getBody());
            if (currentUser.role !== 'admin') {
                const count = Object.values(servers).filter(s => s.owner === currentUser.username).length;
                if (count >= 1) return json({error: 'Limit Reached'}, 400);
                b.ram = '250MB'; b.storage = '1GB';
            }
            const id = Date.now().toString();
            servers[id] = { id, owner: currentUser.username, status: 'stopped', ...b };
            
            // Create folder and index.js
            const folder = path.join(BOTS_DIR, id);
            fs.mkdirSync(folder);
            const code = TEMPLATES[b.type] || TEMPLATES.node;
            fs.writeFileSync(path.join(folder, 'index.js'), code);
            
            saveServers();
            json({id}); return;
        }
    }

    if(req.method === 'DELETE' && req.url.startsWith('/api/servers/')) {
        const id = req.url.split('/').pop();
        const s = servers[id];
        if(s) {
            if (currentUser.role !== 'admin' && s.owner !== currentUser.username) return json({error:'Forbidden'}, 403);
            if(processes[id]) processes[id].kill();
            delete servers[id];
            try { fs.rmSync(path.join(BOTS_DIR, id), { recursive: true, force: true }); } catch(e){}
            saveServers();
            json({ok:true});
        }
        return;
    }

    if(req.url === '/api/control' && req.method === 'POST') {
        const { id, action } = JSON.parse(await getBody());
        const s = servers[id];
        if (!s || (currentUser.role !== 'admin' && s.owner !== currentUser.username)) return json({error:'Forbidden'}, 403);

        if(action === 'start') {
            if(processes[id]) return json({error:'Running'});
            addLog(id, 'sys', 'Starting bot...');
            const env = { ...process.env, BOT_TOKEN: s.env || '' };
            
            // Point to index.js in folder
            const script = path.join(BOTS_DIR, id, 'index.js');
            
            const p = spawn('node', [script], { env });
            p.stdout.on('data', d => addLog(id, 'out', d.toString().trim()));
            p.stderr.on('data', d => addLog(id, 'err', d.toString().trim()));
            p.on('close', c => { processes[id] = null; if(servers[id]) servers[id].status = 'stopped'; });
            processes[id] = p;
            s.status = 'running'; s.pid = p.pid;
            json({ok:true});
        } else {
            if(processes[id]) { processes[id].kill(); processes[id] = null; s.status = 'stopped'; }
            json({ok:true});
        }
        return;
    }

    if(req.url === '/api/terminal' && req.method === 'POST') {
        const { command } = JSON.parse(await getBody());
        if (currentUser.role !== 'admin') {
            if (!command.trim().startsWith('npm install')) return json({ error: 'Permission Denied. Only "npm install" allowed.' });
            if (command.includes(';') || command.includes('&&') || command.includes('|')) return json({ error: 'Complex commands not allowed.' });
        }
        exec(command, { cwd: __dirname }, (error, stdout, stderr) => { json({ output: stdout || stderr || (error ? error.message : 'Done.') }); });
        return;
    }

    if(req.url.startsWith('/api/users')) {
        if(currentUser.role !== 'admin') { json({error:'Forbidden'}, 403); return; }
        if(req.method === 'GET') { json(users); return; }
        if(req.method === 'POST') { const b = JSON.parse(await getBody()); if(users[b.username]) return json({error:'Exists'}); users[b.username] = { password: b.password, role: b.role }; saveUsers(); json({ok:true}); return; }
        if(req.method === 'DELETE') { const u = req.url.split('/').pop(); if(u === ADMIN_USERNAME) return json({error:'Cannot delete root'}); delete users[u]; saveUsers(); json({ok:true}); return; }
    }

    if(req.url === '/api/logs') { json(logs); return; }

    res.writeHead(404); res.end();
});

server.listen(PORT, () => console.log('NEXUS ACTIVE ON PORT ' + PORT));
