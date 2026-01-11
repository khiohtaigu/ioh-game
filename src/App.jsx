import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { db } from './firebaseConfig';
import { ref, set, onValue, update, get } from "firebase/database";

const ROOM_ID = "ROOM_001"; 

const COLORS = {
  cream: '#FFFDE7',  
  gold: '#FCE38A',   
  green: '#95C173',  
  red: '#950707',    
  text: '#2D2926'    
};

const FONT_FAMILY = '"Noto Serif TC", "Songti TC", "STSong", "SimSun", "PMingLiU", "serif"';

export default function App() {
  const [view, setView] = useState('HOME'); 
  const [roomData, setRoomData] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef(null);
  const roomDataRef = useRef(null);

  useEffect(() => {
    const roomRef = ref(db, `rooms/${ROOM_ID}`);
    return onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      setRoomData(data);
      roomDataRef.current = data;
    });
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
      audioRef.current.volume = 0.4;
    }
  }, [isMuted]);

  const resetToHome = async () => {
    if (window.confirm("確定要重置並回到首頁嗎？")) {
      await update(ref(db, `rooms/${ROOM_ID}`), {
        state: 'SETTINGS', subject: null, category: null,
        usedIds: [], roundScores: [], currentRound: 1, score: 0
      });
      setView('HOME');
    }
  };

  const VolumeControl = () => (
    <button onClick={() => setIsMuted(!isMuted)} style={volumeBtnStyle}>
      {isMuted ? '🔇' : '🔊'}
    </button>
  );

  const renderContent = () => {
    if (view === 'ADMIN') return <AdminView onBack={() => setView('HOME')} />;
    
    if (view === 'HOME') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h1 style={responsiveMainTitle}>你講我臆</h1>
          <button style={startBtn} onClick={() => {
            setView('SUBJECT');
            if (audioRef.current) {
              audioRef.current.play().catch(e => console.log("Audio play failed:", e));
            }
          }}>開始挑戰 ➔</button>
        </div>
        <button style={adminEntryBtn} onClick={() => setView('ADMIN')}>⚙️</button>
        <VolumeControl />
      </div>
    );

    if (view === 'SUBJECT') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h2 style={subTitle}>選擇科目</h2>
          <div style={gridContainer}>
            <button style={roleBtn} onClick={() => setView('CATEGORY')}>📜 歷史</button>
            <button style={roleBtnDisabled} disabled>🌍 地理</button>
            <button style={roleBtnDisabled} disabled>⚖️ 公民</button>
          </div>
          <button style={backLink} onClick={() => setView('HOME')}>← 返回</button>
        </div>
        <VolumeControl />
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
                <button key={cat} style={categoryGridBtn} onClick={async () => {
                  await update(ref(db, `rooms/${ROOM_ID}`), { subject: '歷史', category: cat });
                  setView('ROLE');
                }}>{cat}</button>
              ))}
            </div>
            <button style={backLink} onClick={() => setView('SUBJECT')}>← 返回</button>
          </div>
          <VolumeControl />
        </div>
      );
    }

    if (view === 'ROLE') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h2 style={subTitle}>{roomData?.category}<br/>選擇身分</h2>
          <div style={gridContainer}>
            <button style={roleBtn} onClick={() => setView('PROJECTOR')}>💻 投影幕端</button>
            <button style={roleBtn} onClick={() => setView('PLAYER')}>📱 控制器端</button>
          </div>
          <button style={backLink} onClick={() => setView('CATEGORY')}>← 返回</button>
        </div>
        <VolumeControl />
      </div>
    );

    if (view === 'PROJECTOR') return <ProjectorView roomData={roomData} resetSystem={resetToHome} volumeComp={<VolumeControl />} />;
    if (view === 'PLAYER') return <PlayerView roomDataRef={roomDataRef} volumeComp={<VolumeControl />} />;
  };

  return (
    <div style={{fontFamily: FONT_FAMILY, color: COLORS.text, overflowX: 'hidden'}}>
      {/* 活潑輕快遊戲風格背景音樂 (8-bit + Medieval) */}
      <audio ref={audioRef} loop crossOrigin="anonymous">
        <source src="https://cdn.pixabay.com/audio/2024/05/22/audio_349d5c464e.mp3" type="audio/mpeg" />
      </audio>
      {renderContent()}
    </div>
  );
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
      if (window.confirm(`讀取到 ${formatted.length} 筆，確定匯入？`)) {
        set(ref(db, 'question_pool'), formatted).then(() => alert("匯入成功！"));
      }
    };
    reader.readAsArrayBuffer(file);
  };
  return (
    <div style={lobbyContainer}>
      <div style={glassCard}>
        <h2>⚙️ 題庫管理</h2>
        <input type="file" accept=".xlsx" onChange={handleFileUpload} style={{margin: '20px 0'}} />
        <button style={backLink} onClick={onBack}>← 返回</button>
      </div>
    </div>
  );
}

// --- 2. 投影幕組件 (PC端 - 強化佈局防護) ---
function ProjectorView({ roomData, resetSystem, volumeComp }) {
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
    const pool = Object.values(snapshot.val() || {});
    let filtered = roomData.category === '全範圍' ? pool : pool.filter(q => (q.book && q.book.includes(roomData.category)) || (q.category && q.category.includes(roomData.category)));
    if (!roomData.allowDuplicate) filtered = filtered.filter(q => !(roomData.usedIds || []).includes(q.id));
    if (filtered.length === 0) return alert("題目已用完！");
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
          <h2 style={{...subTitle, color: COLORS.red}}>初始設定</h2>
          <div style={settingRow}><span>總回合</span><input type="number" style={inputStyle} value={tempSettings.rounds} onChange={e=>setTempSettings({...tempSettings, rounds: parseInt(e.target.value)})} /></div>
          <div style={settingRow}><span>秒數</span><input type="number" style={inputStyle} value={tempSettings.time} onChange={e=>setTempSettings({...tempSettings, time: parseInt(e.target.value)})} /></div>
          <label style={{display: 'block', margin: '20px 0'}}><input type="checkbox" checked={tempSettings.dup} onChange={e=>setTempSettings({...tempSettings, dup: e.target.checked})} /> 允許重複</label>
          <button style={{...startBtn, background: COLORS.green}} onClick={() => update(ref(db, `rooms/${ROOM_ID}`), { state: 'LOBBY', totalRounds: tempSettings.rounds, timePerRound: tempSettings.time, allowDuplicate: tempSettings.dup })}>儲存設定</button>
        </div>
        {volumeComp}
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
              {roomData.roundScores?.map((r, i) => <div key={i} style={{fontSize: '28px'}}>第 {r.round} 輪：{r.score} 分</div>)}
            </div>
            <h2 style={{fontSize: '64px', color: COLORS.green, marginBottom: '30px'}}>總分：{total}</h2>
            <button style={{...startBtn, background: COLORS.red}} onClick={resetSystem}>重新開始</button>
          </div>
          {volumeComp}
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
        {volumeComp}
      </div>
    );
  }

  const currentQ = roomData.queue?.[roomData.currentIndex];
  const isReview = roomData.state === 'REVIEW';

  return (
    <div style={gameScreenStyle}>
      <div style={topBar}>
        <div style={infoText}>{roomData.category} | RD {roomData.currentRound}</div>
        <div style={{...infoText, color: roomData.timeLeft <= 10 ? '#fff' : COLORS.gold}}>⏳ {roomData.timeLeft}s</div>
        <div style={{...infoText, color: COLORS.green, fontWeight: '900'}}>SCORE: {roomData.score}</div>
        {isReview && <button style={confirmBtn} onClick={async () => {
          const newScores = [...(roomData.roundScores || []), { round: roomData.currentRound, score: roomData.score }];
          const newUsedIds = [...(roomData.usedIds || []), ...roomData.queue.slice(0, roomData.currentIndex).map(q => q.id)];
          await update(ref(db, `rooms/${ROOM_ID}`), { state: roomData.currentRound >= roomData.totalRounds ? 'TOTAL_END' : 'ROUND_END', roundScores: newScores, usedIds: newUsedIds });
        }}>結算 ➔</button>}
        <button style={resetSmallBtn} onClick={resetSystem}>RESET</button>
      </div>
      <div style={mainContent}>
        {/* 左側正確：寬度增加，字體放大 */}
        <div style={sideColumnRedPC}>
          <h3 style={columnTitlePC}>正確</h3>
          <div style={listScroll}>
            {[...(roomData.history || [])].map((h, i) => h.type === '正確' && (
              <div key={i} style={listItemWhitePC} onClick={() => toggleItem(i)}>{h.q}</div>
            )).reverse()}
          </div>
        </div>

        {/* 中間題目：加入 max-width 與 padding 保護文字不越位 */}
        <div style={centerColumnPC}>
          <div style={{fontSize: '36px', color: COLORS.red, marginBottom: '20px', fontWeight: 'bold'}}>{currentQ?.category}</div>
          <div style={mainTermContainer}>
            <h1 style={mainTermStylePC(currentQ?.term || "")}>{currentQ?.term}</h1>
          </div>
          {isReview && <div style={{color: COLORS.red, fontSize: '28px', marginTop: '30px', fontWeight: 'bold'}}>核對模式：點擊兩側可修正</div>}
        </div>

        {/* 右側跳過 */}
        <div style={sideColumnRedPC}>
          <h3 style={columnTitlePC}>跳過</h3>
          <div style={listScroll}>
            {[...(roomData.history || [])].map((h, i) => h.type === '跳過' && (
              <div key={i} style={listItemWhitePC} onClick={() => toggleItem(i)}>{h.q}</div>
            )).reverse()}
          </div>
        </div>
      </div>
      {volumeComp}
    </div>
  );
}

// --- 3. 控制器組件 ---
function PlayerView({ roomDataRef, volumeComp }) {
  const submit = async (type) => {
    const data = roomDataRef.current;
    if (!data || data.state !== 'PLAYING') return;
    const nextIdx = data.currentIndex + 1;
    const currentQ = data.queue[data.currentIndex];
    const newH = [...(data.history || []), { q: currentQ.term, type: type }];
    await update(ref(db, `rooms/${ROOM_ID}`), { currentIndex: nextIdx, score: type === '正確' ? data.score + 1 : data.score, history: newH });
  };
  const data = roomDataRef.current;
  if (!data || data.state !== 'PLAYING') return (
    <div style={layoutStyleMobile}>
      <h2>⏳ 等待中</h2>
      <p>範圍：{data?.category || '未定'}</p>
      {volumeComp}
    </div>
  );
  return (
    <div style={layoutStyleMobile}>
      <h2 style={{fontSize: '24px', color: COLORS.red, position: 'absolute', top: '20px'}}>第 {data.currentRound} 輪</h2>
      <h2 style={{fontSize: 'min(12vw, 48px)', color: COLORS.text, marginBottom: '30px', fontWeight: '900'}}>{data.queue?.[data.currentIndex]?.term}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '90%' }}>
        <button style={{ ...controlBtn, backgroundColor: COLORS.green }} onClick={() => submit('正確')}>正確</button>
        <button style={{ ...controlBtn, backgroundColor: COLORS.red }} onClick={() => submit('跳過')}>跳過</button>
      </div>
      {volumeComp}
    </div>
  );
}

// --- 4. 樣式系統 ---
const lobbyContainer = { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: COLORS.cream, position: 'relative', padding: '10px' };
const glassCard = { background: '#fff', padding: '40px', borderRadius: '30px', boxShadow: '0 15px 35px rgba(0,0,0,0.05)', textAlign: 'center', width: '90%', maxWidth: '500px', border: `3px solid ${COLORS.gold}`, boxSizing: 'border-box' };
const responsiveMainTitle = { fontSize: 'min(15vw, 90px)', fontWeight: '900', color: COLORS.red, marginBottom: '30px', letterSpacing: '5px' };
const subTitle = { fontSize: '28px', marginBottom: '20px', color: COLORS.text, fontWeight: 'bold' };
const gridContainer = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '20px' };
const roleBtn = { padding: '20px', fontSize: '20px', borderRadius: '15px', border: `2px solid ${COLORS.gold}`, background: '#fff', cursor: 'pointer', fontWeight: 'bold', color: COLORS.text, fontFamily: FONT_FAMILY };
const categoryGridBtn = { ...roleBtn, padding: '15px 5px', fontSize: '18px' };
const roleBtnDisabled = { ...roleBtn, background: '#eee', color: '#aaa', cursor: 'not-allowed', border: 'none' };
const startBtn = { padding: '18px', fontSize: '24px', borderRadius: '20px', border: 'none', background: COLORS.gold, color: COLORS.text, fontWeight: 'bold', cursor: 'pointer', width: '100%' };
const backLink = { background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '18px', marginTop: '10px' };
const adminEntryBtn = { position: 'absolute', bottom: '10px', left: '10px', background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', opacity: 0.3 };

// PC 遊戲畫面樣式
const gameScreenStyle = { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: COLORS.cream, overflow: 'hidden' };
const topBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 40px', background: COLORS.text, color: '#fff' };
const infoText = { fontSize: '32px', fontWeight: 'bold' };
const mainContent = { display: 'flex', flex: 1, overflow: 'hidden' };

// 左右欄位：加寬到 20%，字體加粗加大
const sideColumnRedPC = { width: '20%', padding: '20px', background: COLORS.red, display: 'flex', flexDirection: 'column', color: '#fff', boxSizing: 'border-box' };
const columnTitlePC = { fontSize: '28px', borderBottom: '3px solid rgba(255,255,255,0.3)', paddingBottom: '10px', textAlign: 'center', fontWeight: 'bold', marginBottom: '15px' };
const listItemWhitePC = { fontSize: '28px', padding: '15px', margin: '10px 0', borderRadius: '10px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.15)', color: '#fff', textAlign: 'left', fontWeight: 'bold' };

// 中間區域：加入強力的文字溢出防護
const centerColumnPC = { width: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 40px', boxSizing: 'border-box' };
const mainTermContainer = { width: '100%', overflow: 'hidden', textAlign: 'center' };
const mainTermStylePC = (text) => ({ 
  // 針對字數進行動態字體調整，並限制最大寬度
  fontSize: text.length > 7 ? '90px' : text.length > 5 ? '120px' : '170px', 
  whiteSpace: 'nowrap', 
  fontWeight: '900', 
  color: COLORS.text, 
  margin: 0,
  lineHeight: '1.2'
});

const layoutStyleMobile = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', background: COLORS.cream, position: 'relative', padding: '20px', boxSizing: 'border-box' };
const controlBtn = { padding: '35px 0', fontSize: '32px', border: 'none', borderRadius: '25px', color: '#fff', fontWeight: 'bold', width: '100%', fontFamily: FONT_FAMILY };
const inputStyle = { padding: '8px', borderRadius: '8px', border: `2px solid ${COLORS.gold}`, width: '70px', textAlign: 'center', fontSize: '18px' };
const settingRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0', width: '100%' };
const volumeBtnStyle = { position: 'absolute', bottom: '15px', right: '15px', padding: '12px', background: 'rgba(0,0,0,0.2)', border: 'none', borderRadius: '50%', cursor: 'pointer', fontSize: '28px', zIndex: 1000, color: '#fff' };
const listScroll = { flex: 1, overflowY: 'auto' };
const confirmBtn = { padding: '10px 20px', background: COLORS.gold, border: 'none', borderRadius: '8px', color: COLORS.text, fontWeight: 'bold', cursor: 'pointer' };
const resetSmallBtn = { padding: '5px 10px', background: 'transparent', border: '1px solid #555', color: '#aaa', borderRadius: '4px', cursor: 'pointer' };