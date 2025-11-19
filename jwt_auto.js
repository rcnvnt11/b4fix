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

let LAST_JWT = null;

/* === Turnstile Solver === */
async function solveTurnstile() {
    console.log("🤖 Solving Turnstile...");
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
    if (!captcha) {
        console.log("❌ Captcha gagal");
        return null;
    }

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
        console.log("🎉 JWT baru:", v.data.jwt.substring(0, 60), "…");
        return v.data.jwt;
    } catch (e) {
        console.log("❌ Verify:", e.response?.data || e.message);
        return null;
    }
}

/* === RUN B402 === */
async function runMint(jwt) {
    const b402Path = path.join(__dirname, "b402.js");

    return await new Promise((resolve) => {
        const run = spawn(process.execPath, [b402Path, jwt], {
            stdio: "inherit",
            shell: false
        });

        run.on("close", (code) => {
            resolve({ code });
        });
    });
}

/* === MAIN LOOP PER WALLET === */
async function loopWallet(pk) {
    const wallet = new ethers.Wallet(pk).address;

    console.log("\n=======================================");
    console.log(" WALLET:", wallet);
    console.log("=======================================\n");

    while (true) {

        // pakai JWT lama jika ada
        let jwt = LAST_JWT;

        if (!jwt) {
            console.log("🔄 JWT kosong → login dulu");
            jwt = await getJWT(wallet, pk);
            if (!jwt) continue;
            LAST_JWT = jwt;
        }

        console.log("🚀 Jalankan b402.js pakai JWT yang tersimpan...");

        const result = await runMint(jwt);

        // Ada 1 mint success
        if (result.code === 777) {
            console.log("🎉 NFT SUKSES → pindah wallet berikutnya!");
            return;
        }

        // Semua mint gagal tapi JWT VALID → retry
        if (result.code === 0) {
            console.log("🔁 Semua mint gagal, tetapi JWT valid → retry batch...");
            continue;
        }

        // JWT invalid, ambil JWT baru
        console.log("⚠️ JWT invalid → ambil captcha & JWT baru...");
        const newJWT = await getJWT(wallet, pk);
        if (!newJWT) continue;

        LAST_JWT = newJWT;
    }
}

/* === MULTI PRIVATE KEY MODE === */
console.log("=== MULTI PRIVATE KEY MODE ===");
let PKS = [];

while (true) {
    let x = prompt("Private Key: ").trim();
    if (!x) break;
    PKS.push(x);
}

if (PKS.length === 0) {
    console.log("Tidak ada PK, exit");
    process.exit(0);
}

console.log("\n=== MULAI PROSES ===\n");

(async () => {

    for (let i = 0; i < PKS.length; i++) {
        LAST_JWT = null; // reset JWT per wallet
        await loopWallet(PKS[i]);
    }

    console.log("\n🎉 Semua wallet selesai mint!");
    process.exit(0);

})();
