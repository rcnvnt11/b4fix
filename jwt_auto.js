const { spawn } = require("child_process");
const axios = require("axios");
const { ethers } = require("ethers");
const prompt = require("prompt-sync")();
const crypto = require("crypto");
const path = require("path");

/* === CONFIG === */
const CAPTCHA_API_KEY = "685c0e34b8f43899dfb55a40da6f9e5e";
const SITE_KEY = "0x4AAAAAAB5QdBYvpAN8f8ZI";
const PAGE_URL = "https://www.b402.ai/experience-b402";
const CHALLENGE_URL = "https://www.b402.ai/api/api/v1/auth/web3/challenge";
const VERIFY_URL    = "https://www.b402.ai/api/api/v1/auth/web3/verify";

/* === Turnstile Solver === */
async function solveTurnstile() {
    console.log("🤖 Solving Turnstile via 2captcha...");
    const create = `http://2captcha.com/in.php?key=${CAPTCHA_API_KEY}&method=turnstile&sitekey=${SITE_KEY}&pageurl=${PAGE_URL}`;
    const req = await axios.get(create);
    if (!req.data.includes("OK|")) return null;

    const taskId = req.data.split("|")[1];
    while (true) {
        await new Promise(r => setTimeout(r, 5000));
        const poll = await axios.get(
            `http://2captcha.com/res.php?key=${CAPTCHA_API_KEY}&action=get&id=${taskId}`
        );
        if (poll.data === "CAPCHA_NOT_READY") continue;
        if (poll.data.includes("OK|")) {
            console.log("✔ Captcha solved!");
            return poll.data.split("|")[1];
        }
        return null;
    }
}

/* === JWT Builder === */
async function getJWT(wallet, pk) {
    console.log(`\n🔐 LOGIN WALLET: ${wallet}`);
    const captcha = await solveTurnstile();
    if (!captcha) return null;

    const lid = crypto.randomUUID();
    const clientId = "b402-s7chg25x";

    let c;
    try {
        c = await axios.post(CHALLENGE_URL, {
            walletType: "evm",
            walletAddress: wallet,
            turnstileToken: captcha,
            clientId,
            lid
        });
    } catch (e) {
        console.log("❌ Challenge:", e.response?.data || e.message);
        return null;
    }

    const message = c.data.message;
    const signature = await new ethers.Wallet(pk).signMessage(message);

    try {
        const v = await axios.post(VERIFY_URL, {
            walletType: "evm",
            walletAddress: wallet,
            message,
            signature,
            clientId,
            lid
        });
        console.log("🎉 JWT:", v.data.jwt.substring(0, 50), "…");
        return v.data.jwt;
    } catch (e) {
        console.log("❌ Verify:", e.response?.data || e.message);
        return null;
    }
}

/* === LOOP === */
async function loop(pk) {
    const wallet = new ethers.Wallet(pk).address;
    const b402Path = path.join(__dirname, "b402.js");

    while (true) {
        const jwt = await getJWT(wallet, pk);
        if (!jwt) continue;

        console.log("🚀 Running b402.js with JWT...");

        const run = spawn(
            process.execPath,
            [b402Path, jwt],
            { stdio: "inherit", shell: false }
        );

        const code = await new Promise(res => run.on("close", res));

        if (code === 777) {
            console.log("🎉🔥 NFT SUKSES MINT!!! 🔥🎉");
            process.exit(0);
        }

        console.log("⛔ Mint batch gagal → retry JWT...\n");
    }
}

/* === MULTI PK === */
console.log("=== MULTI PRIVATE KEY MODE ===");
let PKS = [];
while (true) {
    let x = prompt("Private Key: ").trim();
    if (!x) break;
    PKS.push(x);
}
if (PKS.length === 0) process.exit(0);

console.log("\n=== STARTING:", new ethers.Wallet(PKS[0]).address, "===\n");
loop(PKS[0]);
