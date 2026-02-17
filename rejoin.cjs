#!/usr/bin/env node
const { execSync, exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const util = require("util");
const readline = require("readline");

// --- 1. DEPENDENCY CHECK & INSTALLATION ---
function ensurePackages() {
  const requiredPackages = ["axios", "cli-table3", "figlet", "boxen", "screenshot-desktop"];
  let needsInstall = false;

  requiredPackages.forEach((pkg) => {
    try {
      require.resolve(pkg);
    } catch {
      console.log(`[System] Đang cài package thiếu: ${pkg}...`);
      needsInstall = true;
    }
  });

  if (needsInstall) {
    try {
      execSync(`npm install ${requiredPackages.join(" ")}`, { stdio: "inherit" });
      console.log("[System] Đã cài đặt xong dependencies!");
    } catch (e) {
      console.error(`[System] Lỗi khi cài packages:`, e.message);
      process.exit(1);
    }
  }
}
ensurePackages();

const axios = require("axios");
const Table = require("cli-table3");
const figlet = require("figlet");
const _boxen = require("boxen");
const boxen = _boxen.default || _boxen;
const screenshot = require("screenshot-desktop");

// Setup đường dẫn Termux
const TERMUX_BIN = "/data/data/com.termux/files/usr/bin";
if (process.env.PATH && !process.env.PATH.includes(TERMUX_BIN)) {
  process.env.PATH = `${TERMUX_BIN}:${process.env.PATH}`;
}

// Kiểm tra Sqlite3
function ensureSystemDependencies() {
  try {
    execSync("command -v sqlite3", { stdio: "ignore" });
  } catch {
    const isRoot = execSync("id -u", { encoding: 'utf8' }).trim() === "0";
    if (isRoot) {
      console.warn("[-] Thiếu sqlite3. Vui lòng chạy lệnh: 'pkg install sqlite' (Không chạy tool bằng root khi cài pkg)");
      process.exit(1);
    } else {
      console.log("[-] Đang cài sqlite3...");
      try {
        execSync("pkg install sqlite -y", { stdio: "inherit" });
      } catch (e) {
        process.exit(1);
      }
    }
  }
}
ensureSystemDependencies();

// --- CONFIG PATHS ---
const CONFIG_PATH = path.join(__dirname, "multi_configs.json");
const WEBHOOK_CONFIG_PATH = path.join(__dirname, "webhook_config.json");
const PREFIX_CONFIG_PATH = path.join(__dirname, "package_prefix_config.json");
const ACTIVITY_CONFIG_PATH = path.join(__dirname, "activity_config.json");
const AUTOEXEC_CONFIG_PATH = path.join(__dirname, "autoexec_config.json");

// --- UTILS CLASS ---
class Utils {
  static ensureRoot() {
    try {
      const uid = execSync("id -u").toString().trim();
      if (uid !== "0") {
        const node = execSync("which node").toString().trim();
        console.log("Cần quyền ROOT để truy cập Data Roblox. Đang chuyển quyền...");
        const child = spawn("su", ["-c", `${node} "${__filename}"`], { stdio: "inherit" });
        child.on('close', (code) => process.exit(code));
        return false; 
      }
      return true;
    } catch (e) {
      console.error("Không thể lấy quyền root:", e.message);
      process.exit(1);
    }
  }

  static enableWakeLock() {
    try {
      exec("termux-wake-lock");
    } catch {}
  }

  // --- LOGIC LAUNCH TỐI ƯU ---
  static async launch(placeId, linkCode = null, packageName) {
    const url = linkCode
      ? `roblox://placeID=${placeId}&linkCode=${linkCode}`
      : `roblox://placeID=${placeId}`;

    let activity;
    const customActivity = this.loadActivityConfig();
    const prefix = this.loadPackagePrefixConfig();

    if (customActivity) {
      activity = customActivity;
    } else {
      // FIX CHO DELTA CLONE THEO YÊU CẦU ĐẠI CA (ActivityNativeMain)
      if (packageName.includes("dinozzz") || packageName.includes("arcgl")) {
        activity = "com.roblox.client.ActivityNativeMain";
      } else {
        // Activity mặc định chuẩn cho bản thường
        activity = `${prefix}.client.ActivityProtocolLaunch`;
      }
    }

    const command = `am start -n ${packageName}/${activity} -a android.intent.action.VIEW -d "${url}" --activity-clear-top`;

    console.log(` [🚀] Launching: ${packageName}`);
    
    return new Promise((resolve) => {
        exec(command, (error) => {
            if (error) {
                console.error(` [❌] Launch failed: ${packageName}`);
            }
            resolve();
        });
    });
  }

  static ask(rl, msg) {
    return new Promise((r) => rl.question(msg, r));
  }

  // --- CONFIG MANAGERS ---
  static saveMultiConfigs(configs) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
  }

  static loadMultiConfigs() {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH)); } catch { return {}; }
  }

  static saveWebhookConfig(config) {
    fs.writeFileSync(WEBHOOK_CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  static loadWebhookConfig() {
    if (!fs.existsSync(WEBHOOK_CONFIG_PATH)) return null;
    try { 
        const conf = JSON.parse(fs.readFileSync(WEBHOOK_CONFIG_PATH));
        if (conf && typeof conf.enabled === 'undefined') conf.enabled = true;
        return conf;
    } catch { return null; }
  }

  static savePackagePrefixConfig(prefix) {
    fs.writeFileSync(PREFIX_CONFIG_PATH, JSON.stringify({ prefix }, null, 2));
  }

  static loadPackagePrefixConfig() {
    if (!fs.existsSync(PREFIX_CONFIG_PATH)) return "com.roblox";
    try { return JSON.parse(fs.readFileSync(PREFIX_CONFIG_PATH)).prefix || "com.roblox"; } catch { return "com.roblox"; }
  }

  static saveActivityConfig(activity) {
    fs.writeFileSync(ACTIVITY_CONFIG_PATH, JSON.stringify({ activity }, null, 2));
  }

  static loadActivityConfig() {
    if (!fs.existsSync(ACTIVITY_CONFIG_PATH)) return null;
    try { return JSON.parse(fs.readFileSync(ACTIVITY_CONFIG_PATH)).activity || null; } catch { return null; }
  }

  // --- SCREENSHOT TỐI ƯU ---
  static async takeScreenshot() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot_${timestamp}.png`;
    const filepath = path.join(__dirname, filename);

    try {
        execSync(`su -c "screencap -p > '${filepath}'"`, { stdio: 'ignore' });
        return filepath;
    } catch (e) {
        console.error("[-] Lỗi chụp ảnh:", e.message);
        return null;
    }
  }

  static deleteScreenshot(filepath) {
    try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch {}
  }

  static async sendWebhookEmbed(webhookUrl, embedData, screenshotPath = null) {
    try {
      if (screenshotPath && fs.existsSync(screenshotPath)) {
        const screenshotBuffer = fs.readFileSync(screenshotPath);
        const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substr(2);
        
        let body = `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="payload_json"\r\n`;
        body += `Content-Type: application/json\r\n\r\n`;
        body += JSON.stringify({ embeds: [embedData] }) + '\r\n';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="status.png"\r\n`;
        body += `Content-Type: image/png\r\n\r\n`;
        
        const payload = Buffer.concat([
            Buffer.from(body, 'utf8'),
            screenshotBuffer,
            Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
        ]);

        await axios.post(webhookUrl, payload, {
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': payload.length
            }
        });

      } else {
        await axios.post(webhookUrl, { embeds: [embedData] });
      }

      if (screenshotPath) setTimeout(() => this.deleteScreenshot(screenshotPath), 2000);
    } catch (e) {
      console.error(`[-] Webhook error: ${e.message}`);
    }
  }

  static detectAllRobloxPackages() {
    const packages = {};
    const prefix = this.loadPackagePrefixConfig();
    
    try {
        const output = execSync("pm list packages", { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const lines = output.split('\n');
        
        lines.forEach(line => {
            const match = line.match(/^package:(.*)$/);
            if (match) {
                const pkg = match[1];
                if (pkg.startsWith(prefix) || pkg.includes("dinozzz") || pkg.includes("roblox")) {
                    let displayName = pkg;
                    if (pkg === "com.roblox.client") displayName = "Roblox Global";
                    else if (pkg === "com.roblox.client.vnggames") displayName = "Roblox VNG";
                    else if (pkg.includes("dinozzz")) displayName = `Delta Clone (${pkg.split('.').pop()})`;
                    
                    packages[pkg] = { packageName: pkg, displayName };
                }
            }
        });
    } catch (e) {}

    return packages;
  }

  // --- COOKIE EXTRACTION TỐI ƯU ---
  static getRobloxCookie(packageName) {
    try {
      const cookiesDbPath = `/data/data/${packageName}/app_webview/Default/Cookies`;
      
      try {
          execSync(`su -c "ls '${cookiesDbPath}'"`, { stdio: 'ignore' });
      } catch {
          return null; 
      }

      const tmpPath = `/sdcard/cookie_dump_${packageName.replace(/\./g,'_')}.db`;
      execSync(`su -c "cp '${cookiesDbPath}' '${tmpPath}'"`);

      const query = `sqlite3 "${tmpPath}" "SELECT value FROM cookies WHERE name = '.ROBLOSECURITY' LIMIT 1"`;
      const cookie = execSync(query, { encoding: 'utf8' }).trim();
      
      execSync(`rm -f "${tmpPath}"`);

      if (cookie && !cookie.startsWith("_")) return "_" + cookie;
      return cookie ? `.ROBLOSECURITY=${cookie}` : null;

    } catch (e) {
      return null;
    }
  }

  static maskSensitiveInfo(text) {
    if (!text || text === 'Unknown') return text;
    const str = text.toString();
    if (str.length <= 4) return str;
    return str.substring(0, 3) + '***' + str.substring(str.length - 3);
  }

  static async openEditor(rl, initialContent = "") {
    console.log("[-] Chế độ nhập liệu đơn giản (Nhập 'END' ở dòng mới để lưu):");
    let lines = initialContent ? initialContent.split('\n') : [];
    if(lines.length > 0) console.log("--- Nội dung cũ --- \n" + initialContent + "\n-------------------");
    
    while (true) {
        const line = await Utils.ask(rl, "> ");
        if (line.trim() === "END") break;
        lines.push(line);
    }
    return lines.join("\n");
  }
}

// --- CLASS ROBLOX USER ---
class RobloxUser {
  constructor(username, userId = null, cookie = null) {
    this.username = username;
    this.userId = userId;
    this.cookie = cookie;
    this.headers = {
        Cookie: this.cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 
        Accept: "application/json",
    };
  }

  async fetchAuthenticatedUser() {
    try {
      const res = await axios.get("https://users.roblox.com/v1/users/authenticated", { headers: this.headers, timeout: 5000 });
      this.username = res.data.name;
      this.userId = res.data.id;
      return this.userId;
    } catch { return null; }
  }

  async getPresence() {
    try {
      const r = await axios.post("https://presence.roproxy.com/v1/presence/users", 
        { userIds: [this.userId] }, 
        { headers: this.headers, timeout: 5000 }
      );
      return r.data.userPresences?.[0];
    } catch { return null; }
  }
}

// --- CLASS UI RENDERER (Clean & Optimized) ---
class UIRenderer {
  static cachedTitle = null;

  static renderTitle() {
    if (this.cachedTitle) return this.cachedTitle;

    const text = figlet.textSync("Dawn Rejoin", { font: "Small" });
    const content = text + "\nOptimized by TrueHieu's request";
    
    this.cachedTitle = boxen(content, { 
        padding: 0, 
        borderStyle: "round", 
        borderColor: "yellow", 
        dimBorder: true 
    });
    return this.cachedTitle;
  }

  static renderTable(instances) {
    const table = new Table({
      head: ['Pkg', 'User', 'Status', 'Wait'],
      colWidths: [15, 12, 20, 8], 
      style: { head: ['cyan'], compact: true }
    });

    instances.forEach(ins => {
      let pkgName = ins.packageName;
      if (pkgName.includes("dinozzz")) pkgName = "Delta " + pkgName.split("arcgl")[1];
      else if (pkgName.length > 12) pkgName = pkgName.substring(0, 10) + "..";

      table.push([
        pkgName,
        Utils.maskSensitiveInfo(ins.config.username),
        ins.status, 
        ins.countdownSeconds + "s"
      ]);
    });

    return table.toString();
  }
}

// --- MAIN TOOL CLASS ---
class MultiRejoinTool {
  constructor() {
    this.instances = [];
    this.isRunning = false;
    this.startTime = Date.now();
  }

  async start() {
    if (!Utils.ensureRoot()) return; 
    Utils.enableWakeLock();

    console.clear();
    console.log(UIRenderer.renderTitle());
    
    const menu = `
 [1] Bắt đầu Auto Rejoin 🚀
 [2] Setup Packages (Quét & Cài đặt) ⚙️
 [3] Config Webhook 🔔
 [4] Autoexec Manager 📜
 [5] Thoát ❌
`;
    console.log(menu);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const choice = await Utils.ask(rl, "Chọn: ");

    switch (choice.trim()) {
      case "1": await this.startAutoRejoin(rl); break;
      case "2": await this.setupPackages(rl); break;
      case "3": await this.setupWebhook(rl); break;
      case "4": await this.setupAutoexec(rl); break;
      case "5": process.exit(0); break;
      default: await this.start(); break;
    }
  }

  async setupPackages(rl) {
    const packages = Utils.detectAllRobloxPackages();
    const packageKeys = Object.keys(packages);

    if (packageKeys.length === 0) {
      console.log("[-] Không tìm thấy Roblox/Delta nào!");
      await new Promise(r => setTimeout(r, 2000));
      return this.start();
    }

    console.log("\n--- Danh sách Package ---");
    packageKeys.forEach((key, idx) => console.log(`${idx + 1}. ${packages[key].displayName}`));
    
    const choice = await Utils.ask(rl, "\nChọn số (VD: 1 2 3 hoặc 0 = Tất cả): ");
    let selected = [];
    
    if (choice.trim() === '0') selected = packageKeys;
    else selected = choice.split(' ').map(i => packageKeys[parseInt(i) - 1]).filter(x => x);

    const configs = {};
    for (const pkg of selected) {
        console.log(`\n[*] Setup cho: ${pkg}`);
        const cookie = Utils.getRobloxCookie(pkg);
        if (!cookie) {
            console.log(" [!] Không tìm thấy cookie (Chưa login?). Bỏ qua.");
            continue;
        }

        const user = new RobloxUser(null, null, cookie);
        const uid = await user.fetchAuthenticatedUser();
        if(!uid) { console.log(" [!] Cookie hết hạn hoặc lỗi mạng."); continue; }

        console.log(` [✓] User: ${user.username}`);
        const placeId = await Utils.ask(rl, " Place ID (Enter mặc định Blox Fruits): ");
        const finalPlaceId = placeId.trim() || "2753915549"; 
        
        configs[pkg] = {
            username: user.username,
            userId: uid,
            placeId: finalPlaceId,
            delaySec: 25, 
            packageName: pkg
        };
    }

    Utils.saveMultiConfigs(configs);
    console.log("[✓] Setup hoàn tất!");
    await new Promise(r => setTimeout(r, 1000));
    this.start();
  }

  async startAutoRejoin(rl) {
    const configs = Utils.loadMultiConfigs();
    const pkgNames = Object.keys(configs);
    
    if (pkgNames.length === 0) {
        console.log("[-] Chưa có config. Hãy Setup Packages trước.");
        await new Promise(r => setTimeout(r, 2000));
        return this.start();
    }

    console.log(`\n[*] Đang khởi động ${pkgNames.length} acc...`);
    
    this.instances = pkgNames.map(pkg => ({
        packageName: pkg,
        config: configs[pkg],
        user: new RobloxUser(configs[pkg].username, configs[pkg].userId, Utils.getRobloxCookie(pkg)),
        status: "Checking...",
        countdownSeconds: 0,
        lastCheck: 0,
        inGame: false
    }));

    this.isRunning = true;
    rl.close(); 
    this.loop();
  }

  async loop() {
    const webhookManager = new WebhookManager(Utils.loadWebhookConfig());
    let loopCount = 0;

    while (this.isRunning) {
        const now = Date.now();

        for (const ins of this.instances) {
            if (now - ins.lastCheck < ins.config.delaySec * 1000) {
                ins.countdownSeconds = Math.ceil((ins.config.delaySec * 1000 - (now - ins.lastCheck)) / 1000);
                continue;
            }

            ins.lastCheck = now;
            ins.countdownSeconds = ins.config.delaySec;

            const presence = await ins.user.getPresence();
            
            let shouldRejoin = false;
            let statusText = "";

            if (!presence) {
                statusText = "API Error";
            } else if (presence.userPresenceType !== 2) { 
                statusText = "Not In Game";
                shouldRejoin = true;
            } else if (presence.rootPlaceId && presence.rootPlaceId.toString() !== ins.config.placeId.toString()) {
                statusText = "Sai Server";
                shouldRejoin = true;
            } else {
                statusText = "🟢 Online";
                ins.inGame = true;
            }

            ins.status = statusText;

            if (shouldRejoin) {
                ins.status = "🚀 Launching...";
                Utils.launch(ins.config.placeId, ins.config.linkCode, ins.packageName);
                await new Promise(r => setTimeout(r, 1000)); 
            }
        }

        if (loopCount % 2 === 0) {
            console.clear();
            console.log(UIRenderer.renderTitle());
            console.log(UIRenderer.renderTable(this.instances));
            
            const uptime = Math.floor((Date.now() - this.startTime) / 1000);
            console.log(`\n[Info] Uptime: ${Math.floor(uptime/60)}m ${uptime%60}s | RAM Free: ${Math.round(os.freemem()/1024/1024)}MB`);
            console.log(`[Info] Ctrl + C để dừng tool.`);
        }

        if (loopCount % 60 === 0) {
            webhookManager.trySend(this.instances, this.startTime);
        }

        loopCount++;
        await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  async setupWebhook(rl) {
      console.log("\n--- Webhook Setup ---");
      const url = await Utils.ask(rl, "Webhook URL: ");
      Utils.saveWebhookConfig({ url: url.trim(), enabled: true, intervalMinutes: 10 });
      console.log("[✓] Đã lưu.");
      this.start();
  }
  
  async setupAutoexec(rl) {
     const autoexecMgr = new AutoexecManager();
     await autoexecMgr.menu(rl);
     this.start();
  }
}

// --- AUTOEXEC MANAGER CLASS (Mini) ---
class AutoexecManager {
    constructor() {
        this.paths = {
            "Delta": "/storage/emulated/0/Delta/Autoexecute/text.txt",
            "Codex": "/storage/emulated/0/Codex/Autoexec/text.txt",
            "Arceus": "/storage/emulated/0/Arceus X/Autoexec/text.txt"
        };
    }
    
    async menu(rl) {
        console.log("\nChọn Executor:");
        const keys = Object.keys(this.paths);
        keys.forEach((k, i) => console.log(`${i+1}. ${k}`));
        const idx = await Utils.ask(rl, "> ");
        const key = keys[parseInt(idx)-1];
        
        if (!key) return;
        console.log("Nhập Script (Gõ END để lưu):");
        const script = await Utils.openEditor(rl);
        
        const targetPath = this.paths[key];
        const dir = path.dirname(targetPath);
        
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(targetPath, script, 'utf8');
            console.log(`[✓] Đã lưu vào ${key}`);
            
            fs.writeFileSync(AUTOEXEC_CONFIG_PATH, JSON.stringify({ executor: key, script, path: targetPath }));
        } catch (e) {
            console.log(`[❌] Lỗi ghi file: ${e.message}`);
        }
    }
}

// --- WEBHOOK MANAGER CLASS (Mini) ---
class WebhookManager {
    constructor(config) {
        this.config = config;
        this.lastSent = 0;
    }
    
    async trySend(instances, startTime) {
        if (!this.config || !this.config.enabled || !this.config.url) return;
        
        const intervalMs = (this.config.intervalMinutes || 10) * 60 * 1000;
        if (Date.now() - this.lastSent < intervalMs) return;
        
        const uptime = Math.floor((Date.now() - startTime) / 60000); 
        const onlineCount = instances.filter(i => i.inGame).length;
        
        const embed = {
            title: "📈 Farm Status Report",
            color: 65280, 
            fields: [
                { name: "Uptime", value: `${uptime} minutes`, inline: true },
                { name: "Active", value: `${onlineCount}/${instances.length}`, inline: true },
                { name: "Details", value: instances.map(i => `${i.packageName.split('.').pop()}: ${i.status}`).join('\n') }
            ],
            footer: { text: "Dawn Rejoin Optimized" },
            timestamp: new Date().toISOString()
        };
        
        await Utils.sendWebhookEmbed(this.config.url, embed, null); 
        this.lastSent = Date.now();
    }
}

(async () => {
  const tool = new MultiRejoinTool();
  await tool.start();
})();


