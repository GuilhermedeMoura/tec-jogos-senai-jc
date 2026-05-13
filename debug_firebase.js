const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const { getStorage, ref, getBytes } = require('firebase/storage');

const firebaseConfig = {
  apiKey: "AIzaSyD0J8UyDyOxhhpj9pvNj-eUuSRiWJ8Qjv8",
  authDomain: "tec-jogos-senai-jc.firebaseapp.com",
  projectId: "tec-jogos-senai-jc",
  storageBucket: "tec-jogos-senai-jc.firebasestorage.app",
  messagingSenderId: "952832354030",
  appId: "1:952832354030:web:93698003ddef974521f5ff"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app, 'gs://tec-jogos-senai-jc.firebasestorage.app');

async function test() {
    console.log("Fetching games from Firestore...");
    const snapshot = await getDocs(collection(db, "games"));
    let count = 0;
    for (const doc of snapshot.docs) {
        const game = doc.data();
        console.log(`\nGame: ${game.title} (ID: ${game.id})`);
        
        try {
            const storageRef = ref(storage, `games/${game.id}.zip`);
            await getBytes(storageRef);
            console.log(` -> ZIP exists and is accessible!`);
        } catch (e) {
            console.error(` -> Error downloading ZIP: ${e.code || e.message}`);
        }
        count++;
        if (count >= 5) break; // test only first 5
    }
    console.log("Done.");
}

test().catch(console.error);
