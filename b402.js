require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const { Worker } = require("worker_threads");
const prompt = require("prompt-sync")();

/* ============================================
   AUTO RECEIVE JWT FROM jwt_auto.js
============================================ */
let AUTO_JWT = null;
if (process.argv[2]) {
    AUTO_JWT = process.argv[2];
    process.env.JWT = process.argv[2];
}

/* ------------ MAIN WRAPPER FOR RESTART ------------ */
async function start() {

    console.log("\n=== B402 SPAM MINT ===");
    console.log("JWT manual mode aktif (menu 2 only)\n");

    /* ============================================
       JWT INPUT (AUTO FROM jwt_auto.js OR MANUAL)
    ============================================= */
    let JWT_INPUT = AUTO_JWT;
    if (!JWT_INPUT) {
        JWT_INPUT = prompt("Paste JWT here: ").trim();
    }
    if (!JWT_INPUT) {
        console.log("❌ ERROR: JWT empty");
        return start();
    }

    /* ------------ ORIGINAL CONFIG (TIDAK DIUBAH) ------------ */
    const {
        PRIVATE_KEY,
        JWT,
        MINT_COUNT,
        WORKER_COUNT,
        APPROVE,
        RPC = "",
        API_BASE = "https://www.b402.ai/api/api/v1",
        RELAYER = "0xE1Af7DaEa624bA3B5073f24A6Ea5531434D82d88",
        TOKEN = "0x55d398326f99059fF775485246999027B3197955",
    } = process.env;

    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const WALLET = wallet.address;
    const RECIPIENT = wallet.address;

    /* ------------ APPROVE FUNCTION (ORI) ------------ */
    async function approveUnlimited() {
        const abi = ["function approve(address spender, uint256 value)"];
        const token = new ethers.Contract(TOKEN, abi, wallet);
        const Max = ethers.MaxUint256;
        console.log("--- Approving unlimited USDT for relayer...");
        const tx = await token.approve(RELAYER, Max);
        console.log("--- Approve TX:", tx.hash);
        await tx.wait();
        console.log("--- Unlimited USDT approved!");
    }

    /* ------------ BUILD PERMIT (ORI) ------------ */
    async function buildPermit(amount, relayer) {
        const net = await provider.getNetwork();
        const now = Math.floor(Date.now() / 1000);
        const msg = {
            token: TOKEN,
            from: WALLET,
            to: WALLET,
            value: amount,
            validAfter: 0,
            validBefore: now + 1800,
            nonce: ethers.hexlify(ethers.randomBytes(32))
        };
        const domain = {
            name: "B402",
            version: "1",
            chainId: net.chainId,
            verifyingContract: relayer
        };
        const types = {
            TransferWithAuthorization: [
                { name: "token", type: "address" },
                { name: "from", type: "address" },
                { name: "to", type: "address" },
                { name: "value", type: "uint256" },
                { name: "validAfter", type: "uint256" },
                { name: "validBefore", type: "uint256" },
                { name: "nonce", type: "bytes32" }
            ]
        };
        const sig = await wallet.signTypedData(domain, types, msg);
        return { authorization: msg, signature: sig };
    }

    /* ------------ MAIN EXECUTION (ORI) ------------ */
    console.log("B402 - WORKERS - SPAM - OTW 🚀");
    const jwt = JWT_INPUT;

    if (!APPROVE) {
        await approveUnlimited();
    }

    console.log("--- Fetching JWT ...");
    let pay;
    try {
        await axios.post(
            `${API_BASE}/faucet/drip`,
            { recipientAddress: RECIPIENT },
            { headers: { Authorization: `Bearer ${jwt}` } }
        );
    } catch (err) {
        if (err.response?.status === 402) {
            pay = err.response.data.paymentRequirements;
            console.log("--- JWT VALID");
        } else {
            throw new Error("--- JWT Invalid");
        }
    }

    const MINT = Number(MINT_COUNT);
    console.log(`--- Building ${MINT} permits in parallel...`);

    const permits = await Promise.all(
        [...Array(MINT)].map(async () => {
            const p = await buildPermit(pay.amount, pay.relayerContract);
            return p;
        })
    );

    console.log(`✔ Permit Success`);
    console.log(`\n[Spam ${WORKER_COUNT} workers]`);

    let nextTask = 0;
    let finished = 0;
    const workers = [];

    function assignJob(worker) {
        if (nextTask >= MINT) return;
        const p = permits[nextTask];
        const jobIndex = nextTask;
        worker.postMessage({
            index: jobIndex + 1,
            jwt,
            API_BASE,
            RECIPIENT,
            TOKEN,
            p,
            pay,
        });
        nextTask++;
    }

    for (let i = 0; i < WORKER_COUNT; i++) {
        const worker = new Worker("./helper-workers.js");
        workers.push(worker);

        worker.on("message", (res) => {
            finished++;

            if (res.success) {
                console.log(`🟩 Mint #${res.index} SUCCESS → ${res.tx}`);
                process.exit(777); // <-- SIGNAL TO jwt_auto.js
            } else {
                console.log(`🟥 Mint #${res.index} FAILED → ${JSON.stringify(res.error)}`);
            }

            if (finished === MINT) {
                console.log("\n📌 Semua mint selesai (gagal semua)");
                process.exit(0);
            }

            assignJob(worker);
        });

        assignJob(worker);
    }
}

start();
