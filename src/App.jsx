import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { db } from './firebaseConfig';
import { ref, set, onValue, update, get, runTransaction } from "firebase/database";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";

const COLORS = { cream: '#FFFDE7', gold: '#FCE38A', green: '#95C173', red: '#950707', text: '#2D2926' };
const FONT_FAMILY = '"Noto Serif TC", "Songti TC", "STSong", "SimSun", "PMingLiU", "serif"';
const iconFilterRed = 'invert(11%) sepia(87%) saturate(6011%) hue-rotate(354deg) brightness(85%) contrast(116%)';
const iconFilterGold = 'invert(88%) sepia(21%) saturate(769%) hue-rotate(344deg) brightness(102%) contrast(101%)';

// --- 版權聲明 ---
const CopyrightFooter = () => (
  <div style={footerStyle}>© 2025 你講我臆ＸKhiohtaigu. All Rights Reserved.</div>
);

export default function App() {
  const [view, setView] = useState('HOME'); 
  const [user, setUser] = useState(null);
  const [roomId, setRoomId] = useState(""); // 動態房間 ID
  const [roomData, setRoomData] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [availableCats, setAvailableCats] = useState([]); 
  const [totalSessions, setTotalSessions] = useState(0); // 累計使用次數
  const audioRef = useRef(null);
  const auth = getAuth();

  useEffect(() => {
    document.title = "你講我臆";
    // 監聽累計使用次數 (Session 計數)
    onValue(ref(db, 'stats/totalSessions'), (s) => setTotalSessions(s.val() || 0));
    // 監聽登入狀態
    return auth.onAuthStateChanged(u => setUser(u));
  }, []);

  // 監聽題庫分類
  useEffect(() => {
    onValue(ref(db, 'question_pool'), (snapshot) => {
      if (snapshot.exists()) {
        const pool = Object.values(snapshot.val());
        setAvailableCats([...new Set(pool.map(item => String(item.book || "").trim()))]);
      }
    });
  }, []);

  // 監聽特定房間資料
  useEffect(() => {
    if (!roomId) return;
    const unsub = onValue(ref(db, `rooms/${roomId}`), (snapshot) => {
      setRoomData(snapshot.val());
    });
    return () => unsub();
  }, [roomId]);

  useEffect(() => {
    if (audioRef.current) { audioRef.current.muted = roomData?.isPaused ? true : isMuted; audioRef.current.volume = 0.4; }
  }, [isMuted, roomData?.isPaused]);

  // Google 登入
  const handleLogin = () => {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).then(() => setView('SUBJECT')).catch(console.error);
  };

  // 建立新房間 (投影幕端)
  const createRoom = () => {
    const newId = Math.floor(1000 + Math.random() * 9000).toString(); // 產生 4 碼
    setRoomId(newId);
    set(ref(db, `rooms/${newId}`), {
      state: 'SETTINGS',
      currentRound: 1,
      score: 0,
      isPaused: false,
      hostName: user?.displayName
    });
    setView('PROJECTOR_SETTINGS');
  };

  const handleStartApp = () => {
    if (!user) handleLogin();
    else setView('SUBJECT');
    if (audioRef.current) audioRef.current.play().catch(() => {});
  };

  const VolumeControl = () => (
    <button onClick={() => setIsMuted(!isMuted)} style={volumeBtnStyle}>
      <img src="/music.png" alt="music" style={{ width: '100%', height: '100%', filter: isMuted ? 'grayscale(1)' : iconFilterRed, opacity: isMuted ? 0.3 : 1 }} />
    </button>
  );

  const renderContent = () => {
    if (view === 'ADMIN') return <AdminView onBack={() => setView('HOME')} />;
    
    if (view === 'HOME') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <div style={titleContainer}><h1 style={responsiveTitle}>你講我臆</h1></div>
          <button style={startBtn} onClick={handleStartApp}>{user ? "進入遊戲 ➔" : "Google 登入開始挑战"}</button>
          {user && <p style={{marginTop: '10px', fontSize: '14px'}}>歡迎，{user.displayName} <span style={{cursor: 'pointer', color: COLORS.red}} onClick={()=>signOut(auth)}>(登出)</span></p>}
        </div>
        <button style={adminEntryBtn} onClick={() => setView('ADMIN')}>⚙️ 題庫匯入</button>
        <CopyrightFooter />
      </div>
    );

    if (view === 'SUBJECT') return (
      <div style={lobbyContainer}>
        <div style={glassCard}>
          <h2 style={subTitle}>選擇科目</h2>
          <div style={mobileVerticalGrid}>
            <button style={roleBtnCard} onClick={() => setView('CATEGORY')}><span style={iconLarge}>📜</span> 歷史</button>
            <button style={roleBtnDisabled} disabled><span style={iconLarge}>🌍</span> 地理</button>
            <button style={roleBtnDisabled} disabled><span style={iconLarge}>⚖️</span> 公民</button>
          </div>
          <button style={backLink} onClick={() => setView('HOME')}>← 返回</button>
        </div>
        <CopyrightFooter />
      </div>
    );

    if (view === 'CATEGORY') {
      const categories = ["台灣史", "東亞史", "世界史", "歷史選修上", "歷史選修下", "全範圍"];
      return (
        <div style={lobbyContainer}>
          <div style={glassCard}>
            <h2 style={subTitle}>選擇範圍</h2>
            <div style={mobileGrid}>
              {categories.map(cat => (
                <button key={cat} style={(availableCats.includes(cat) || cat==="全範圍") ? catBtnMobile : catBtnDisabled}
                  onClick={() => { update(ref(db, `rooms/${roomId}`), {category: cat}); setView('ROLE'); }}>{cat}</button>
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
          <h2 style={subTitle}>選擇身份</h2>
          <div style={mobileVerticalGrid}>
            <button style={roleBtnCard} onClick={createRoom}><span style={iconLarge}>💻</span> 我是投影幕 (新房間)</button>
            <button style={roleBtnCard} onClick={() => setView('JOIN_ROOM')}><span style={iconLarge}>📱</span> 我是控制器 (加入)</button>
          </div>
        </div>
      </div>
    );

    if (view === 'JOIN_ROOM') return <JoinRoomView setRoomId={setRoomId} setView={setView} />;
    if (view === 'PROJECTOR_SETTINGS') return <ProjectorSettings roomId={roomId} roomData={roomData} setView={setView} />;
    if (view === 'PROJECTOR_GAME') return <ProjectorGameView roomId={roomId} roomData={roomData} resetToHome={() => setView('HOME')} totalSessions={totalSessions} />;
    if (view === 'PLAYER') return <PlayerView roomId={roomId} roomData={roomData} />;
  };

  return (
    <div style={{fontFamily: FONT_FAMILY, color: COLORS.text, overflowX: 'hidden'}}>
      <audio ref={audioRef} loop src="/bgm.mp3" crossOrigin="anonymous" />
      {renderContent()}
      <VolumeControl />
    </div>
  );
}

// --- 輔助組件：加入房間 ---
function JoinRoomView({ setRoomId, setView }) {
  const [code, setCode] = useState("");
  const handleJoin = async () => {
    const s = await get(ref(db, `rooms/${code}`));
    if (s.exists()) { setRoomId(code); setView('PLAYER'); }
    else alert("找不到該房間，請檢查代碼！");
  };
  return (
    <div style={lobbyContainer}><div style={glassCard}>
      <h2>輸入投影幕上的 4 碼代碼</h2>
      <input type="text" style={{...inputStyle, width: '200px', fontSize: '3rem', margin: '20px 0'}} maxLength="4" value={code} onChange={e=>setCode(e.target.value)} />
      <button style={startBtn} onClick={handleJoin}>進入房間 ➔</button>
      <button style={backLink} onClick={()=>setView('ROLE')}>← 返回</button>
    </div></div>
  );
}

// --- 輔助組件：老師設定畫面 ---
function ProjectorSettings({ roomId, roomData, setView }) {
  const [rounds, setRounds] = useState(3);
  const [time, setTime] = useState(180);
  const [dup, setDup] = useState(false);

  const saveAndStart = async () => {
    // 增加全局使用次數 (真正的使用率)
    runTransaction(ref(db, 'stats/totalSessions'), (c) => (c || 0) + 1);

    await update(ref(db, `rooms/${roomId}`), {
      state: 'LOBBY', totalRounds: rounds, timePerRound: time, allowDuplicate: dup
    });
    setView('PROJECTOR_GAME');
  };

  return (
    <div style={lobbyContainer}><div style={glassCard}>
      <h1 style={{color: COLORS.red, fontSize: '3rem'}}>{roomId}</h1>
      <p>請學生輸入以上代碼加入</p>
      <hr/>
      <div style={settingRow}><span>總回合數</span><input type="number" style={inputStyle} value={rounds} onChange={e=>setRounds(parseInt(e.target.value)||0)} /></div>
      <div style={settingRow}><span>每輪秒數</span><input type="number" style={inputStyle} value={time} onChange={e=>setTime(parseInt(e.target.value)||0)} /></div>
      <label style={{display: 'block', margin: '20px 0', fontSize: '1.2rem'}}><input type="checkbox" checked={dup} onChange={e=>setDup(e.target.checked)} /> 允許重複題目</label>
      <button style={startBtn} onClick={saveAndStart}>儲存設定 ➔</button>
    </div></div>
  );
}

// --- 投影幕遊戲主畫面 (保持 15/70/15) ---
function ProjectorGameView({ roomId, roomData, resetToHome, totalSessions }) {
  useEffect(() => {
    let timer;
    if (roomData?.state === 'PLAYING' && roomData.timeLeft > 0 && !roomData.isPaused) {
      timer = setInterval(() => update(ref(db, `rooms/${roomId}`), { timeLeft: roomData.timeLeft - 1 }), 1000);
    } else if (roomData?.timeLeft === 0 && roomData.state === 'PLAYING') {
      update(ref(db, `rooms/${roomId}`), { state: 'REVIEW' });
    }
    return () => clearInterval(timer);
  }, [roomData?.state, roomData?.timeLeft, roomData?.isPaused]);

  const startRound = async () => {
    const snapshot = await get(ref(db, 'question_pool'));
    const pool = Object.values(snapshot.val() || {});
    let filtered = roomData.category === '全範圍' ? pool : pool.filter(q => q.book === roomData.category);
    if (!roomData.allowDuplicate) filtered = filtered.filter(q => !(roomData.usedIds || []).includes(q.id));
    const shuffled = filtered.sort(() => Math.random() - 0.5);
    await update(ref(db, `rooms/${roomId}`), { state: 'PLAYING', queue: shuffled, currentIndex: 0, score: 0, history: [], timeLeft: roomData.timePerRound });
  };

  if (!roomData || roomData.state === 'LOBBY' || roomData.state === 'ROUND_END' || roomData.state === 'TOTAL_END') {
     // ... 此處保持您之前滿意的 Lobby/End 佈局，僅將 ID 與重置按鈕正確連結 ...
     return (
        <div style={lobbyContainer}><div style={glassCard}>
          <h1>房間代碼：<span style={{color: COLORS.red}}>{roomId}</span></h1>
          {roomData?.state === 'TOTAL_END' ? <h2>🏆 最終分數：{roomData.roundScores.reduce((a,b)=>a+b.score,0)}</h2> : <h2>等待開始第 {roomData?.currentRound} 輪</h2>}
          <button style={startBtn} onClick={roomData?.state === 'TOTAL_END' ? resetToHome : startRound}>
            {roomData?.state === 'TOTAL_END' ? "回首頁" : "開始挑戰"}
          </button>
        </div></div>
     );
  }

  const currentQ = roomData.queue?.[roomData.currentIndex];
  const isReview = roomData.state === 'REVIEW';
  const isTimeWarning = roomData.timeLeft <= 10;
  const timerIconStyle = { height: '30px', filter: iconFilterGold, animation: (isTimeWarning && !roomData.isPaused) ? 'ioh-blink 0.5s infinite' : 'none' };

  return (
    <div style={gameScreenStyle}>
      <div style={topBar}>
        <div style={infoText}>{roomData.category} | 代碼: {roomId}</div>
        <div style={{...infoText, color: isTimeWarning ? '#fff' : COLORS.gold, display: 'flex', alignItems: 'center', gap: '10px'}}>
          <img src="/time.png" alt="time" style={timerIconStyle} /><span>{roomData.timeLeft}s</span>
        </div>
        <div style={{...infoText, color: COLORS.green}}>SCORE: {roomData.score}</div>
        <div style={{display: 'flex', gap: '10px'}}>
           {!isReview && <button onClick={()=>update(ref(db, `rooms/${roomId}`), {isPaused: !roomData.isPaused})} style={pauseIconBtn}><img src="/pause.png" alt="pause" style={{height:'28px', filter:iconFilterGold}}/></button>}
           <button style={resetSmallBtn} onClick={resetToHome}>RESET</button>
           <div style={userCounterStyle}><span style={{fontSize:'12px', opacity:0.6}}>累積開局</span><br/>{totalSessions}次</div>
        </div>
      </div>
      <div style={mainContent}>
        <div style={sideColumnPC}><h3 style={columnTitlePC}>正確</h3><div style={listScroll}>{(roomData.history || []).map((h, i) => h.type === '正確' && (<div key={i} style={listItemWhitePC} onClick={() => isReview && toggleHistory(roomId, roomData, i)}>✓ {h.q}</div>)).reverse()}</div></div>
        <div style={centerColumnPC}>
          {roomData.isPaused ? <h1 style={{fontSize: '100px', color: COLORS.gold}}>暫停</h1> : <>
            <div style={{fontSize: '32px', color: COLORS.red}}>{currentQ?.category}</div>
            <h1 style={mainTermStylePC(currentQ?.term || "")}>{currentQ?.term}</h1>
          </>}
        </div>
        <div style={sideColumnPC}><h3 style={columnTitlePC}>跳過</h3><div style={listScroll}>{(roomData.history || []).map((h, i) => h.type === '跳過' && (<div key={i} style={listItemWhitePC} onClick={() => isReview && toggleHistory(roomId, roomData, i)}>✘ {h.q}</div>)).reverse()}</div></div>
      </div>
      <CopyrightFooter />
    </div>
  );
}

// 歷史修正輔助函數
const toggleHistory = (rid, data, idx) => {
  const newH = [...data.history];
  newH[idx].type = newH[idx].type === '正確' ? '跳過' : '正確';
  update(ref(db, `rooms/${rid}`), { history: newH, score: newH.filter(h=>h.type==='正確').length });
};

// --- 控制器組件 ---
function PlayerView({ roomId, roomData }) {
  const handleBtnClick = async (type) => {
    if (!roomData || roomData.state !== 'PLAYING' || roomData.isPaused) return;
    const nextIdx = roomData.currentIndex + 1;
    const currentQ = roomData.queue[roomData.currentIndex];
    const newH = [...(roomData.history || []), { q: currentQ.term, type: type }];
    await update(ref(db, `rooms/${roomId}`), { currentIndex: nextIdx, score: type === '正確' ? roomData.score + 1 : roomData.score, history: newH });
  };
  if (!roomData) return <div style={layoutStyleMobile}><h2>📡 連線中...</h2></div>;
  if (roomData.state !== 'PLAYING') return <div style={layoutStyleMobile}><h2>⏳ 等待開始 (房號: {roomId})</h2></div>;
  const currentQ = roomData.queue[roomData.currentIndex];
  return (
    <div style={layoutStyleMobile}>
      <h2 style={mobileHeader}>房號: {roomId} | 第 {roomData.currentRound} 輪</h2>
      <div style={mobileTermCard}><h2 style={mobileTermText}>{currentQ?.term}</h2></div>
      <div style={mobileButtonArea}>
        <button style={{ ...mobileActionBtn, backgroundColor: COLORS.green }} onClick={() => handleBtnClick('正確')}>正確</button>
        <button style={{ ...mobileActionBtn, backgroundColor: COLORS.red }} onClick={() => handleBtnClick('跳過')}>跳過</button>
      </div>
    </div>
  );
}

// --- 管理後台 ---
function AdminView({ onBack }) {
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      let all = [];
      workbook.SheetNames.forEach(n => {
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[n]);
        all = [...all, ...json.map(i => ({ id: i['序號']||Math.random(), term: String(i['名詞']||''), book: String(i['分冊']||'').trim() }))];
      });
      set(ref(db, 'question_pool'), all).then(() => alert("匯入成功！"));
    };
    reader.readAsArrayBuffer(file);
  };
  return <div style={lobbyContainer}><div style={glassCard}><h2>題庫管理</h2><input type="file" onChange={handleFileUpload}/><button style={backLink} onClick={onBack}>返回</button></div></div>;
}

// --- 樣式設定 (與之前保持一致並優化) ---
const lobbyContainer = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: COLORS.cream, position: 'relative' };
const glassCard = { background: '#fff', padding: '40px', borderRadius: '30px', border: `4px solid ${COLORS.gold}`, textAlign: 'center', width: '90%', maxWidth: '500px' };
const responsiveTitle = { fontSize: 'clamp(2.5rem, 10vw, 5rem)', fontWeight: '900', color: COLORS.red, letterSpacing: '10px' };
const startBtn = { padding: '20px', fontSize: '1.5rem', borderRadius: '20px', border: 'none', background: COLORS.gold, fontWeight: 'bold', cursor: 'pointer', width: '100%' };
const inputStyle = { padding: '12px', borderRadius: '10px', border: `2px solid ${COLORS.gold}`, width: '120px', textAlign: 'center', fontSize: '1.5rem' };
const settingRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '15px 0', width: '100%', fontWeight: 'bold' };
const gameScreenStyle = { display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: COLORS.cream, overflow: 'hidden' };
const topBar = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 40px', background: COLORS.text, color: '#fff' };
const infoText = { fontSize: '24px', fontWeight: 'bold' };
const mainContent = { display: 'flex', flex: 1 };
const sideColumnPC = { width: '15%', padding: '20px', background: COLORS.red, color: '#fff', overflowY: 'auto' };
const centerColumnPC = { width: '70%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' };
const mainTermStylePC = (t) => ({ fontSize: t.length > 8 ? '80px' : '150px', fontWeight: '900', color: COLORS.text, textAlign: 'center' });
const listItemWhitePC = { fontSize: '24px', padding: '10px', margin: '5px 0', background: 'rgba(255,255,255,0.2)', borderRadius: '8px', cursor: 'pointer' };
const columnTitlePC = { fontSize: '28px', borderBottom: '2px solid #fff', paddingBottom: '10px', marginBottom: '10px' };
const layoutStyleMobile = { display: 'flex', flexDirection: 'column', height: '100vh', background: COLORS.cream, padding: '20px', textAlign: 'center' };
const mobileTermCard = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: '25px', border: `3px solid ${COLORS.gold}` };
const mobileTermText = { fontSize: '3rem', fontWeight: '900' };
const mobileActionBtn = { padding: '30px 0', fontSize: '2.5rem', borderRadius: '20px', border: 'none', color: '#fff', fontWeight: 'bold', width: '100%' };
const mobileVerticalGrid = { display: 'flex', flexDirection: 'column', gap: '15px', width: '100%' };
const roleBtnCard = { display: 'flex', alignItems: 'center', padding: '15px', fontSize: '1.2rem', borderRadius: '15px', border: `2px solid ${COLORS.gold}`, background: '#fff', fontWeight: 'bold' };
const iconLarge = { fontSize: '2rem', marginRight: '10px' };
const roleBtnDisabled = { ...roleBtnCard, background: '#eee', color: '#aaa' };
const catBtnMobile = { padding: '10px', borderRadius: '10px', border: `2px solid ${COLORS.gold}`, background: '#fff', fontWeight: 'bold' };
const catBtnDisabled = { ...catBtnMobile, background: '#eee', color: '#aaa' };
const subTitle = { fontSize: '1.5rem', marginBottom: '20px' };
const backLink = { background: 'none', border: 'none', color: '#888', marginTop: '10px' };
const adminEntryBtn = { position: 'absolute', bottom: '20px', left: '20px', background: 'none', border: 'none', opacity: 0.3 };
const volumeBtnStyle = { position: 'fixed', bottom: '20px', right: '20px', width: '60px', height: '60px', background: '#fff', border: `2px solid ${COLORS.gold}`, borderRadius: '50%', padding: '10px' };
const footerStyle = { position: 'absolute', bottom: '30px', width: '100%', textAlign: 'center', fontSize: '12px', opacity: 0.5 };
const mobileGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' };
const mainTermContainer = { padding: '0 40px' };
const resetSmallBtn = { padding: '5px 10px', background: 'transparent', border: '1px solid #fff', color: '#fff', borderRadius: '4px' };
const pauseIconBtn = { background: 'none', border: 'none' };
const confirmBtn = { padding: '10px 20px', background: COLORS.gold, borderRadius: '8px', fontWeight: 'bold' };
const userCounterStyle = { textAlign: 'right', borderLeft: '1px solid #fff', paddingLeft: '10px' };
const mobileButtonArea = { display: 'flex', flexDirection: 'column', gap: '10px', paddingBottom: '30px' };
const mobileHeader = { margin: '20px 0' };