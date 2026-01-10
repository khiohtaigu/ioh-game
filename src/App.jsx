import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebaseConfig';
import { ref, set, onValue, update, get, remove } from "firebase/database";

const ROOM_ID = "ROOM_001"; 

export default function App() {
  const [role, setRole] = useState(null); 
  const [roomData, setRoomData] = useState(null);
  const roomDataRef = useRef(null);

  // 1. 全域監聽
  useEffect(() => {
    const roomRef = ref(db, `rooms/${ROOM_ID}`);
    return onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      setRoomData(data);
      roomDataRef.current = data;
    });
  }, []);

  // 2. 強制重置功能
  const resetSystem = async () => {
    if (window.confirm("確定要重置所有遊戲設定與分數嗎？")) {
      await set(ref(db, `rooms/${ROOM_ID}`), {
        state: 'SETTINGS',
        totalRounds: 3,
        timePerRound: 180,
        allowDuplicate: false,
        usedIds: [],
        roundScores: [],
        currentRound: 1
      });
    }
  };

  // 3. 啟動單輪遊戲邏輯
  const startRound = async () => {
    const snapshot = await get(ref(db, 'question_pool'));
    if (!snapshot.exists()) return alert("請先匯入題庫！");
    
    const pool = Object.values(snapshot.val());
    const settings = roomDataRef.current;
    
    // 過濾掉已使用過的題目 (如果設定為不重複)
    let availablePool = settings.allowDuplicate 
      ? pool 
      : pool.filter(q => !(settings.usedIds || []).includes(q.id));

    if (availablePool.length === 0) {
      alert("題目已用完！請重置遊戲或允許重複題目。");
      return;
    }

    const shuffled = availablePool.sort(() => Math.random() - 0.5);

    await update(ref(db, `rooms/${ROOM_ID}`), {
      state: 'PLAYING',
      queue: shuffled,
      currentIndex: 0,
      score: 0,
      history: [],
      timeLeft: settings.timePerRound
    });
  };

  if (!role) {
    return (
      <div style={layoutStyle}>
        <h1 style={{color: '#1890ff', fontSize: '48px'}}>台灣史「你講我猜」系統</h1>
        <div style={{display: 'flex', gap: '20px'}}>
          <button style={bigBtn} onClick={() => setRole('projector')}>💻 我是投影幕</button>
          <button style={bigBtn} onClick={() => setRole('player')}>📱 我是控制器</button>
        </div>
      </div>
    );
  }

  return role === 'projector' ? 
    <ProjectorView roomData={roomData} startRound={startRound} resetSystem={resetSystem} /> : 
    <PlayerView roomDataRef={roomDataRef} />;
}

// --- 投影幕組件 ---
function ProjectorView({ roomData, startRound, resetSystem }) {
  const [settings, setSettings] = useState({ rounds: 3, time: 180, dup: false });

  // 計時器邏輯
  useEffect(() => {
    let timer;
    if (roomData?.state === 'PLAYING' && roomData.timeLeft > 0) {
      timer = setInterval(() => {
        update(ref(db, `rooms/${ROOM_ID}`), { timeLeft: roomData.timeLeft - 1 });
      }, 1000);
    } else if (roomData?.timeLeft === 0 && roomData.state === 'PLAYING') {
      finishRound();
    }
    return () => clearInterval(timer);
  }, [roomData?.state, roomData?.timeLeft]);

  const finishRound = async () => {
    const data = roomData;
    const roundScore = { round: data.currentRound, score: data.score };
    const newRoundScores = [...(data.roundScores || []), roundScore];
    const newUsedIds = [...(data.usedIds || []), ...data.queue.slice(0, data.currentIndex).map(q => q.id)];
    
    await update(ref(db, `rooms/${ROOM_ID}`), {
      state: data.currentRound >= data.totalRounds ? 'TOTAL_END' : 'ROUND_END',
      roundScores: newRoundScores,
      usedIds: newUsedIds
    });
  };

  const saveSettings = async () => {
    await update(ref(db, `rooms/${ROOM_ID}`), {
      state: 'LOBBY',
      totalRounds: settings.rounds,
      timePerRound: settings.time,
      allowDuplicate: settings.dup,
      currentRound: 1,
      roundScores: [],
      usedIds: []
    });
  };

  // 1. 設定畫面
  if (!roomData || roomData.state === 'SETTINGS') {
    return (
      <div style={layoutStyle}>
        <h1>遊戲初始設定</h1>
        <div style={settingCard}>
          <label>總回合數：<input type="number" value={settings.rounds} onChange={e=>setSettings({...settings, rounds: parseInt(e.target.value)})} /></label><br/>
          <label>每輪時間 (秒)：<input type="number" value={settings.time} onChange={e=>setSettings({...settings, time: parseInt(e.target.value)})} /></label><br/>
          <label><input type="checkbox" checked={settings.dup} onChange={e=>setSettings({...settings, dup: e.target.checked})} /> 允許題目重複出現</label>
          <button style={btnStyle} onClick={saveSettings}>儲存設定</button>
        </div>
      </div>
    );
  }

  // 2. 準備開始畫面
  if (roomData.state === 'LOBBY' || roomData.state === 'ROUND_END') {
    const isNext = roomData.state === 'ROUND_END';
    return (
      <div style={layoutStyle}>
        <h1>{isNext ? `第 ${roomData.currentRound} 回合結束` : "準備就緒"}</h1>
        {isNext && <h2 style={{color: '#ff4d4f'}}>本輪得分：{roomData.score}</h2>}
        <h2 style={{margin: '20px'}}>即將進行：第 {isNext ? roomData.currentRound + 1 : roomData.currentRound} 回合</h2>
        <button style={btnStyle} onClick={async () => {
          if(isNext) await update(ref(db, `rooms/${ROOM_ID}`), { currentRound: roomData.currentRound + 1 });
          startRound();
        }}>開始挑戰</button>
        <button style={{...btnStyle, backgroundColor: '#888', marginLeft: '10px'}} onClick={resetSystem}>重置回首頁</button>
      </div>
    );
  }

  // 3. 總結算畫面
  if (roomData.state === 'TOTAL_END') {
    const totalScore = roomData.roundScores.reduce((a, b) => a + b.score, 0);
    return (
      <div style={layoutStyle}>
        <h1 style={{fontSize: '60px'}}>🏆 最終總結算</h1>
        <div style={historyBox}>
          {roomData.roundScores.map((r, i) => <div key={i} style={{fontSize: '32px'}}>第 {r.round} 回合：{r.score} 分</div>)}
          <hr/>
          <div style={{fontSize: '48px', color: '#1890ff'}}>總計得分：{totalScore}</div>
        </div>
        <button style={btnStyle} onClick={resetSystem}>回首頁重新開始</button>
      </div>
    );
  }

  // 4. 遊戲進行中 (三欄式)
  const currentQ = roomData.queue?.[roomData.currentIndex];
  const correctHistory = roomData.history?.filter(h => h.type === '正確') || [];
  const skipHistory = roomData.history?.filter(h => h.type === '跳過') || [];

  return (
    <div style={gameScreenStyle}>
      <div style={topBar}>
        <div style={infoText}>第 {roomData.currentRound} / {roomData.totalRounds} 輪</div>
        <div style={infoText}>⏳ {roomData.timeLeft}s</div>
        <div style={infoText}>🚩 SCORE: {roomData.score}</div>
        <button onClick={resetSystem} style={{background: 'none', color: '#555', border: '1px solid #555', cursor: 'pointer'}}>RESET</button>
      </div>
      <div style={mainContent}>
        <div style={sideColumn}>
          <h3 style={{color: '#28a745', borderBottom: '1px solid #28a745'}}>正確</h3>
          <div style={listScroll}>
            {correctHistory.slice().reverse().map((h, i) => <div key={i} style={listItemGreen}>✓ {h.q}</div>)}
          </div>
        </div>
        <div style={centerColumn}>
          <div style={{fontSize: '32px', color: '#666', marginBottom: '20px'}}>{currentQ?.category}</div>
          <h1 style={mainTermStyle}>{currentQ?.term}</h1>
        </div>
        <div style={sideColumn}>
          <h3 style={{color: '#dc3545', borderBottom: '1px solid #dc3545'}}>跳過</h3>
          <div style={listScroll}>
            {skipHistory.slice().reverse().map((h, i) => <div key={i} style={listItemRed}>✘ {h.q}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 控制器組件 ---
function PlayerView({ roomDataRef }) {
  const submitAction = async (type) => {
    const data = roomDataRef.current;
    if (!data || data.state !== 'PLAYING') return;
    const nextIndex = data.currentIndex + 1;
    const currentQ = data.queue[data.currentIndex];
    const newHistory = [...(data.history || []), { q: currentQ.term, type: type }];
    await update(ref(db, `rooms/${ROOM_ID}`), {
      currentIndex: nextIndex,
      score: type === '正確' ? data.score + 1 : data.score,
      history: newHistory
    });
  };

  const data = roomDataRef.current;
  if (!data || data.state !== 'PLAYING') return <div style={layoutStyle}><h2>等待遊戲開始...</h2></div>;

  return (
    <div style={{ ...layoutStyle, backgroundColor: '#1890ff', color: '#fff' }}>
      <div style={{fontSize: '24px', position: 'absolute', top: '20px'}}>第 {data.currentRound} 回合</div>
      <h2 style={{fontSize: '48px', marginBottom: '50px'}}>{data.queue?.[data.currentIndex]?.term}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '80%' }}>
        <button style={{ ...controlBtn, backgroundColor: '#28a745' }} onClick={() => submitAction('正確')}>正確</button>
        <button style={{ ...controlBtn, backgroundColor: '#dc3545' }} onClick={() => submitAction('跳過')}>跳過</button>
      </div>
    </div>
  );
}

// --- 樣式設定 ---
const layoutStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', padding: '20px', backgroundColor: '#f0f2f5' };
const gameScreenStyle = { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#000', color: '#fff', overflow: 'hidden' };
const topBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 40px', backgroundColor: '#111', borderBottom: '1px solid #333' };
const infoText = { fontSize: '28px', fontWeight: 'bold' };
const mainContent = { display: 'flex', flex: 1, overflow: 'hidden' };
const sideColumn = { width: '15%', padding: '15px', backgroundColor: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column' };
const centerColumn = { width: '70%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #222', borderRight: '1px solid #222' };
const mainTermStyle = { fontSize: 'min(12vw, 160px)', whiteSpace: 'nowrap', fontWeight: '900', textShadow: '0 0 20px rgba(24,144,255,0.5)' };
const listScroll = { flex: 1, overflowY: 'auto', marginTop: '10px' };
const listItemGreen = { fontSize: '20px', padding: '5px 0', color: '#a8e6cf', textAlign: 'left' };
const listItemRed = { fontSize: '20px', padding: '5px 0', color: '#ffd3b6', textAlign: 'left' };
const bigBtn = { padding: '20px 40px', fontSize: '24px', borderRadius: '15px', border: 'none', backgroundColor: '#1890ff', color: '#fff', cursor: 'pointer' };
const btnStyle = { padding: '15px 40px', fontSize: '24px', borderRadius: '10px', border: 'none', backgroundColor: '#28a745', color: '#fff', marginTop: '20px', cursor: 'pointer' };
const controlBtn = { padding: '35px', fontSize: '32px', border: 'none', borderRadius: '20px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' };
const settingCard = { backgroundColor: '#fff', padding: '40px', borderRadius: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '20px', lineHeight: '2.5' };
const historyBox = { backgroundColor: '#fff', padding: '30px', borderRadius: '15px', color: '#333', width: '60%', textAlign: 'center' };