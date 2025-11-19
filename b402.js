require('dotenv').config();
const axios = require('axios');
const { ethers } = require('ethers');
const { Worker } = require("worker_threads");

/* ===============================================
   b402.js FINAL — Batch Full 500 → Check Result
   Success >=1 → exit 777 (ganti wallet)
   Success = 0 → exit 0  (retry batch)
   JWT INVALID → throw error (jwt_auto ambil baru)
   +++ Tambahan: LOG WALLET & INDEX setiap batch
================================================ */
let AUTO_JWT = null;
let WALLET_INDEX = process.env.WALLET_INDEX || null;

if (process.argv[3]) WALLET_INDEX = process.argv[3];
if (process.argv[2]) {
    AUTO_JWT = process.argv[2];
    process.env.JWT = process.argv[2];
}

async function start() {

    const {
        PRIVATE_KEY,
        MINT_COUNT,
        APPROVE,
        RPC = "https://rpc.ankr.com/bsc/b107dc2c0b183923e678913e18e080df0f7ba76f6a1b7c7dc70bcddc7718cc97",
        API_BASE = "https://www.b402.ai/api/api/v1",
        RELAYER = "0xE1Af7DaEa624bA3B5073f24A6Ea5531434D82d88",
        TOKEN = "0x55d398326f99059fF775485246999027B3197955",
    } = process.env;

    const provider = new ethers.JsonRpcProvider(RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const WALLET = wallet.address;
    const RECIPIENT = wallet.address;
    const jwt = AUTO_JWT;

    /* ================================
       LOG WALLET SETIAP BATCH DIMULAI
    ================================= */
    console.log("\n=======================================");
    console.log(`🔐 WALLET #${WALLET_INDEX || "?"} → ${WALLET}`);
    console.log(`🔑 JWT USED: ${jwt ? jwt.substring(0, 45) + "…" : "null"}`);
    console.log("=======================================\n");

    /* APPROVE */
    async function approveUnlimited() {
        const abi = ["function approve(address spender, uint256 value)"];
        const token = new ethers.Contract(TOKEN, abi, wallet);
        const Max = ethers.MaxUint256;
        const tx = await token.approve(RELAYER, Max);
        await tx.wait();
    }

    if (!APPROVE) {
        await approveUnlimited();
    }

    /* VALIDATE JWT properly */
    let pay;
    try {
        await axios.post(
            `${API_BASE}/faucet/drip`,
            { recipientAddress: RECIPIENT },
            { headers: { Authorization: `Bearer ${jwt}` } }
        );
        throw new Error("FREE_MINT_HABIS");
    } catch (err) {
        if (err.response?.status === 402) {
            pay = err.response.data.paymentRequirements;
        } else if (err.response?.status === 401 || err.response?.status === 403) {
            throw new Error("JWT_INVALID");
        } else {
            console.log("⚠️ Unexpected error:", err.response?.data || err);
            throw new Error("JWT_INVALID");
        }
    }

    const M = Number(MINT_COUNT);

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

    console.log(`🔧 Build ${M} permits...`);
    const permits = await Promise.all(
        [...Array(M)].map(async () => {
            return await buildPermit(pay.amount, pay.relayerContract);
        })
    );

    const WORKERS = 50;
    let nextTask = 0;
    let finished = 0;
    let successCount = 0;

    function spawnWorker() {
        const worker = new Worker("./helper-workers.js");

        worker.on("message", (res) => {
            finished++;

            if (res.success) {
                successCount++;
                console.log(`🟩 SUCCESS #${res.index}`);
            } else {
                console.log(`🟥 FAIL #${res.index}`);
            }

            if (finished === M) {
                console.log(`\n📌 Batch selesai (${finished}/${M})`);
                console.log(`📊 Success count: ${successCount}`);

                if (successCount > 0) {
                    console.log("🎉 Ada success → exit 777 (ganti wallet)");
                    process.exit(777);
                } else {
                    console.log("🔁 Tidak ada success → exit 0 (retry batch)");
                    process.exit(0);
                }
                return;
            }

            assign(worker);
        });

        worker.on("error", () => {
            console.log("⚠️ Worker crash → respawn ulang");
            spawnWorker();
        });

        return worker;
    }

    function assign(worker) {
        if (nextTask >= M) return;
        const p = permits[nextTask];

        worker.postMessage({
            index: nextTask + 1,
            jwt,
            API_BASE,
            RECIPIENT,
            TOKEN,
            p,
            pay,
        });

        nextTask++;
    }

    console.log(`🚀 Running with ${WORKERS} workers...`);

    for (let i = 0; i < WORKERS; i++) {
        const w = spawnWorker();
        assign(w);
    }
}

start();

