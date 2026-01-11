import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { db } from './firebaseConfig';
import { ref, set, onValue, update, get } from "firebase/database";

const ROOM_ID = "ROOM_001"; 

// --- 定義色票 ---
const COLORS = {
  cream: '#FFFDE7',  // 頂層米白
  gold: '#FCE38A',   // 第二層淡金
  green: '#95C173',  // 第三層草綠
  red: '#950707',    // 底層深紅
  text: '#2D2926'    // 深褐黑文字
};

export default function App() {
  const [view, setView] = useState('HOME'); 
  const [roomData, setRoomData] = useState(null);
  const roomDataRef = useRef(null);

  useEffect(() => {
    const roomRef = ref(db, `rooms/${ROOM_ID}`);
    return onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      setRoomData(data);
      roomDataRef.current = data;
    });
  }, []);

  const resetToHome = async () => {
    if (window.confirm("確定要重置並回到首頁嗎？")) {
      await update(ref(db, `rooms/${ROOM_ID}`), {
        state: 'SETTINGS', subject: null, category: null,
        usedIds: [], roundScores: [], currentRound: 1, score: 0
      });
      setView('HOME');
    }
  };

  const renderContent = () => {
    if (view === 'ADMIN') return <AdminView onBack={() => setView('HOME')} />;
    
    if (view === 'HOME') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h1 style={mainTitleStyle}>你講我臆</h1>
          <button style={startBtn} onClick={() => setView('SUBJECT')}>開始點按 ➔</button>
        </div>
        <button style={adminEntryBtn} onClick={() => setView('ADMIN')}>⚙️ 題庫匯入</button>
      </div>
    );

    if (view === 'SUBJECT') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h2 style={subTitle}>選擇科目</h2>
          <div style={gridContainer}>
            <button style={roleBtn} onClick={() => setView('CATEGORY')}>📜 歷史</button>
            <button style={roleBtnDisabled} disabled>🌍 地理 (建置中)</button>
            <button style={roleBtnDisabled} disabled>⚖️ 公民 (建置中)</button>
          </div>
          <button style={backLink} onClick={() => setView('HOME')}>← 返回</button>
        </div>
      </div>
    );

    if (view === 'CATEGORY') {
      const categories = ["台灣史", "東亞史", "世界史", "選修上", "選修下", "全範圍"];
      return (
        <div style={lobbyContainer}>
          <div style={glassCard}>
            <h2 style={subTitle}>選擇範圍</h2>
            <div style={gridContainer}>
              {categories.map(cat => (
                <button key={cat} style={roleBtn} onClick={async () => {
                  await update(ref(db, `rooms/${ROOM_ID}`), { subject: '歷史', category: cat });
                  setView('ROLE');
                }}>{cat}</button>
              ))}
            </div>
            <button style={backLink} onClick={() => setView('SUBJECT')}>← 返回</button>
          </div>
        </div>
      );
    }

    if (view === 'ROLE') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h2 style={subTitle}>{roomData?.category} - 選擇身分</h2>
          <div style={{display: 'flex', gap: '20px', justifyContent: 'center'}}>
            <button style={roleBtn} onClick={() => setView('PROJECTOR')}>💻 投影幕端</button>
            <button style={roleBtn} onClick={() => setView('PLAYER')}>📱 控制器端</button>
          </div>
          <button style={backLink} onClick={() => setView('CATEGORY')}>← 返回</button>
        </div>
      </div>
    );

    if (view === 'PROJECTOR') return <ProjectorView roomData={roomData} resetSystem={resetToHome} />;
    if (view === 'PLAYER') return <PlayerView roomDataRef={roomDataRef} />;
  };

  return <div style={{fontFamily: '"Microsoft JhengHei", sans-serif', color: COLORS.text}}>{renderContent()}</div>;
}

// --- 1. 管理後台 ---
function AdminView({ onBack }) {
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet);
      const formatted = json.map(i => ({
        id: i['序號'] || Math.random(),
        term: i['名詞'] || '',
        book: String(i['分冊'] || ''),
        category: String(i['章節'] || ''),
        keywords: i['關鍵字'] || ''
      }));
      if (window.confirm(`讀取到 ${formatted.length} 筆題目，確定匯入嗎？`)) {
        set(ref(db, 'question_pool'), formatted).then(() => alert("匯入成功！"));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div style={lobbyContainer}>
      <div style={glassCard}>
        <h2 style={{color: COLORS.red}}>⚙️ 題庫管理系統</h2>
        <input type="file" accept=".xlsx" onChange={handleFileUpload} style={{margin: '30px 0'}} />
        <br/>
        <button style={backLink} onClick={onBack}>← 返回首頁</button>
      </div>
    </div>
  );
}

// --- 2. 投影幕組件 ---
function ProjectorView({ roomData, resetSystem }) {
  const [tempSettings, setTempSettings] = useState({ rounds: 3, time: 180, dup: false });

  useEffect(() => {
    let timer;
    if (roomData?.state === 'PLAYING' && roomData.timeLeft > 0) {
      timer = setInterval(() => update(ref(db, `rooms/${ROOM_ID}`), { timeLeft: roomData.timeLeft - 1 }), 1000);
    } else if (roomData?.timeLeft === 0 && roomData.state === 'PLAYING') {
      update(ref(db, `rooms/${ROOM_ID}`), { state: 'REVIEW' });
    }
    return () => clearInterval(timer);
  }, [roomData?.state, roomData?.timeLeft]);

  const startRound = async () => {
    const snapshot = await get(ref(db, 'question_pool'));
    if (!snapshot.exists()) return alert("資料庫是空的！");
    const pool = Object.values(snapshot.val());
    let filtered = roomData.category === '全範圍' ? pool : pool.filter(q => (q.book && q.book.includes(roomData.category)) || (q.category && q.category.includes(roomData.category)));
    if (!roomData.allowDuplicate) filtered = filtered.filter(q => !(roomData.usedIds || []).includes(q.id));
    if (filtered.length === 0) return alert(`範圍「${roomData.category}」題目已用完！`);
    const shuffled = filtered.sort(() => Math.random() - 0.5);
    await update(ref(db, `rooms/${ROOM_ID}`), { state: 'PLAYING', queue: shuffled, currentIndex: 0, score: 0, history: [], timeLeft: roomData.timePerRound });
  };

  const toggleItem = async (idx) => {
    const newH = [...roomData.history];
    newH[idx].type = newH[idx].type === '正確' ? '跳過' : '正確';
    await update(ref(db, `rooms/${ROOM_ID}`), { history: newH, score: newH.filter(h => h.type === '正確').length });
  };

  if (!roomData || roomData.state === 'SETTINGS') {
    return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h2 style={{...subTitle, color: COLORS.red}}>初始設定 ({roomData?.category})</h2>
          <div style={settingRow}><span>總回合數</span><input type="number" style={inputStyle} value={tempSettings.rounds} onChange={e=>setTempSettings({...tempSettings, rounds: parseInt(e.target.value)})} /></div>
          <div style={settingRow}><span>每輪秒數</span><input type="number" style={inputStyle} value={tempSettings.time} onChange={e=>setTempSettings({...tempSettings, time: parseInt(e.target.value)})} /></div>
          <label style={{display: 'block', margin: '20px 0', fontSize: '18px', cursor: 'pointer'}}><input type="checkbox" checked={tempSettings.dup} onChange={e=>setTempSettings({...tempSettings, dup: e.target.checked})} /> 允許題目重複</label>
          <button style={{...startBtn, background: COLORS.green}} onClick={() => update(ref(db, `rooms/${ROOM_ID}`), { state: 'LOBBY', totalRounds: tempSettings.rounds, timePerRound: tempSettings.time, allowDuplicate: tempSettings.dup })}>儲存設定</button>
          <button style={backLink} onClick={resetSystem}>取消</button>
        </div>
      </div>
    );
  }

  if (roomData.state === 'LOBBY' || roomData.state === 'ROUND_END' || roomData.state === 'TOTAL_END') {
    if (roomData.state === 'TOTAL_END') {
      const total = (roomData.roundScores || []).reduce((a, b) => a + b.score, 0);
      return (
        <div style={lobbyContainer}>
          <div style={glassCard}>
            <h1 style={{fontSize: '48px', color: COLORS.red}}>🏆 總成績結算</h1>
            <div style={{margin: '30px 0'}}>
              {roomData.roundScores?.map((r, i) => <div key={i} style={{fontSize: '24px', margin: '5px'}}>第 {r.round} 輪：{r.score} 分</div>)}
            </div>
            <h2 style={{fontSize: '64px', color: COLORS.green, marginBottom: '30px'}}>總分：{total}</h2>
            <button style={{...startBtn, background: COLORS.red}} onClick={resetSystem}>重新開始</button>
          </div>
        </div>
      );
    }
    return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h1 style={{fontSize: '32px', color: COLORS.red}}>{roomData.state === 'ROUND_END' ? `第 ${roomData.currentRound} 輪結束` : "準備就緒"}</h1>
          <h2 style={{margin: '30px 0', color: COLORS.green, fontSize: '60px'}}>第 {roomData.state === 'ROUND_END' ? roomData.currentRound + 1 : roomData.currentRound} 輪</h2>
          <button style={{...startBtn, background: COLORS.green}} onClick={async () => {
            if(roomData.state === 'ROUND_END') await update(ref(db, `rooms/${ROOM_ID}`), { currentRound: roomData.currentRound + 1 });
            startRound();
          }}>開始挑戰</button>
          <button style={backLink} onClick={resetSystem}>重置回首頁</button>
        </div>
      </div>
    );
  }

  const currentQ = roomData.queue?.[roomData.currentIndex];
  const isReview = roomData.state === 'REVIEW';

  return (
    <div style={gameScreenStyle}>
      <div style={topBar}>
        <div style={infoText}>{roomData.category} | RD {roomData.currentRound}</div>
        <div style={{...infoText, color: roomData.timeLeft <= 10 ? COLORS.red : COLORS.gold}}>⏳ {roomData.timeLeft}s</div>
        <div style={{...infoText, color: COLORS.green}}>SCORE: {roomData.score}</div>
        {isReview && <button style={confirmBtn} onClick={async () => {
          const newScores = [...(roomData.roundScores || []), { round: roomData.currentRound, score: roomData.score }];
          const newUsedIds = [...(roomData.usedIds || []), ...roomData.queue.slice(0, roomData.currentIndex).map(q => q.id)];
          await update(ref(db, `rooms/${ROOM_ID}`), { state: roomData.currentRound >= roomData.totalRounds ? 'TOTAL_END' : 'ROUND_END', roundScores: newScores, usedIds: newUsedIds });
        }}>確認結算 ➔</button>}
        <button style={resetSmallBtn} onClick={resetSystem}>RESET</button>
      </div>
      <div style={mainContent}>
        <div style={sideColumnCorrect}>
          <h3 style={columnTitle}>正確</h3>
          <div style={listScroll}>
            {[...(roomData.history || [])].map((h, i) => h.type === '正確' && (
              <div key={i} style={listItemGreen} onClick={() => toggleItem(i)}>{h.q}</div>
            )).reverse()}
          </div>
        </div>
        <div style={centerColumn}>
          <div style={{fontSize: '32px', color: COLORS.red, marginBottom: '10px'}}>{currentQ?.category}</div>
          <h1 style={mainTermStyle(currentQ?.term || "")}>{currentQ?.term}</h1>
          {isReview && <div style={{color: COLORS.red, fontSize: '28px', marginTop: '30px', fontWeight: 'bold'}}>核對模式：可點擊清單修正</div>}
        </div>
        <div style={sideColumnSkip}>
          <h3 style={columnTitle}>跳過</h3>
          <div style={listScroll}>
            {[...(roomData.history || [])].map((h, i) => h.type === '跳過' && (
              <div key={i} style={listItemRed} onClick={() => toggleItem(i)}>{h.q}</div>
            )).reverse()}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 3. 控制器組件 ---
function PlayerView({ roomDataRef }) {
  const submit = async (type) => {
    const data = roomDataRef.current;
    if (!data || data.state !== 'PLAYING') return;
    const nextIdx = data.currentIndex + 1;
    const currentQ = data.queue[data.currentIndex];
    const newH = [...(data.history || []), { q: currentQ.term, type: type }];
    await update(ref(db, `rooms/${ROOM_ID}`), { currentIndex: nextIdx, score: type === '正確' ? data.score + 1 : data.score, history: newH });
  };
  const data = roomDataRef.current;
  if (!data || data.state !== 'PLAYING') return <div style={layoutStyleMobile}><h2>⏳ 等待開始...</h2><p>範圍：{data?.category}</p></div>;
  return (
    <div style={{ ...layoutStyleMobile, backgroundColor: COLORS.cream }}>
      <h2 style={{fontSize: '32px', color: COLORS.red, position: 'absolute', top: '20px'}}>第 {data.currentRound} 輪</h2>
      <h2 style={{fontSize: '54px', color: COLORS.text, marginBottom: '50px', fontWeight: '900'}}>{data.queue?.[data.currentIndex]?.term}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '85%' }}>
        <button style={{ ...controlBtn, backgroundColor: COLORS.green }} onClick={() => submit('正確')}>正確</button>
        <button style={{ ...controlBtn, backgroundColor: COLORS.red }} onClick={() => submit('跳過')}>跳過</button>
      </div>
    </div>
  );
}

// --- 4. 樣式系統 (全面導入色票) ---
const lobbyContainer = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: COLORS.cream, position: 'relative' };
const glassCard = { background: '#fff', padding: '50px', borderRadius: '40px', boxShadow: '0 20px 50px rgba(0,0,0,0.05)', textAlign: 'center', minWidth: '500px', border: `4px solid ${COLORS.gold}` };
const mainTitleStyle = { fontSize: '100px', fontWeight: '900', color: COLORS.red, marginBottom: '50px', letterSpacing: '15px' };
const subTitle = { fontSize: '32px', marginBottom: '40px', color: COLORS.text, fontWeight: 'bold' };
const gridContainer = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '40px' };
const roleBtn = { padding: '25px', fontSize: '24px', borderRadius: '20px', border: `2px solid ${COLORS.gold}`, background: '#fff', cursor: 'pointer', fontWeight: 'bold', color: COLORS.text };
const roleBtnDisabled = { ...roleBtn, background: '#eee', color: '#aaa', cursor: 'not-allowed', border: 'none' };
const startBtn = { padding: '20px 60px', fontSize: '28px', borderRadius: '25px', border: 'none', background: COLORS.gold, color: COLORS.text, fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 5px 15px rgba(0,0,0,0.1)' };
const backLink = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px', marginTop: '20px' };
const adminEntryBtn = { position: 'absolute', bottom: '20px', left: '20px', background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', opacity: 0.3 };

const gameScreenStyle = { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: COLORS.cream };
const topBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 40px', background: COLORS.text, color: '#fff' };
const infoText = { fontSize: '26px', fontWeight: 'bold' };
const mainContent = { display: 'flex', flex: 1, overflow: 'hidden' };

const sideColumnCorrect = { width: '15%', padding: '15px', background: COLORS.green, display: 'flex', flexDirection: 'column', color: '#fff' };
const sideColumnSkip = { width: '15%', padding: '15px', background: COLORS.red, display: 'flex', flexDirection: 'column', color: '#fff' };
const columnTitle = { fontSize: '22px', borderBottom: '2px solid rgba(255,255,255,0.3)', paddingBottom: '10px', textAlign: 'center' };

const centerColumn = { width: '70%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px' };
const mainTermStyle = (text) => ({ 
  fontSize: text.length > 8 ? 'min(7vw, 90px)' : text.length > 5 ? 'min(10vw, 120px)' : 'min(14vw, 180px)', 
  whiteSpace: 'nowrap', fontWeight: '900', color: COLORS.text, margin: 0 
});

const listScroll = { flex: 1, overflowY: 'auto' };
const listItemGreen = { fontSize: '22px', padding: '10px', margin: '8px 0', borderRadius: '8px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', textAlign: 'left', fontWeight: 'bold' };
const listItemRed = { fontSize: '22px', padding: '10px', margin: '8px 0', borderRadius: '8px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', textAlign: 'left', fontWeight: 'bold' };

const resetSmallBtn = { padding: '5px 10px', background: 'transparent', border: '1px solid #555', color: '#888', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
const confirmBtn = { padding: '10px 20px', background: COLORS.gold, border: 'none', borderRadius: '8px', color: COLORS.text, fontWeight: 'bold', cursor: 'pointer' };

const layoutStyleMobile = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', background: COLORS.cream };
const controlBtn = { padding: '40px', fontSize: '36px', border: 'none', borderRadius: '25px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' };
const settingRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', width: '100%', fontSize: '20px' };
const inputStyle = { padding: '10px', borderRadius: '10px', border: `2px solid ${COLORS.gold}`, width: '100px', textAlign: 'center', fontSize: '18px' };