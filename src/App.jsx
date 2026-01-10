import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebaseConfig';
import { ref, set, onValue, update, get } from "firebase/database";

const ROOM_ID = "ROOM_001";

export default function App() {
  const [role, setRole] = useState(null); 
  const [roomData, setRoomData] = useState(null);
  const [inputText, setInputText] = useState("");
  const [gameMode, setGameMode] = useState("simultaneous"); // simultaneous, turn-based

  useEffect(() => {
    return onValue(ref(db, `rooms/${ROOM_ID}`), (s) => s.exists() && setRoomData(s.val()));
  }, []);

  // --- 老師邏輯：隨機分組與抽籤 ---
  const handleCreateTeams = async () => {
    const names = inputText.split(/[\s,]+/).filter(n => n.trim());
    if (names.length < 2) return alert("請輸入至少兩個名字");

    const shuffled = names.sort(() => Math.random() - 0.5);
    const newTeams = {};
    for (let i = 0; i < shuffled.length; i += 2) {
      const teamId = `team_${i/2 + 1}`;
      const members = shuffled.slice(i, i + 2);
      newTeams[teamId] = {
        id: teamId,
        name: `第 ${i/2 + 1} 組`,
        members: members,
        guesser: members[0],
        describer: members[1] || members[0],
        score: 0,
        currentIndex: 0,
        history: [],
        state: 'IDLE'
      };
    }

    await set(ref(db, `rooms/${ROOM_ID}`), {
      teams: newTeams,
      state: 'TEAMS_READY',
      config: { mode: gameMode, timeLimit: 180 },
      timeLeft: 180
    });
  };

  // --- 老師邏輯：啟動遊戲 ---
  const handleStartMaster = async () => {
    const snapshot = await get(ref(db, 'question_pool'));
    const pool = Object.values(snapshot.val());
    
    if (gameMode === 'simultaneous') {
      // 同步模式：生成一組共同題庫
      const commonQueue = pool.sort(() => Math.random() - 0.5);
      await update(ref(db, `rooms/${ROOM_ID}`), {
        state: 'PLAYING',
        commonQueue: commonQueue,
        timeLeft: 180,
        startTime: Date.now()
      });
    } else {
      // 輪流模式：僅更改狀態，各組開始時才各自抓題
      await update(ref(db, `rooms/${ROOM_ID}`), { state: 'PLAYING', timeLeft: 180 });
    }
  };

  if (!role) {
    return (
      <div style={layoutStyle}>
        <h1>台灣史「你講我猜」</h1>
        <button style={bigBtn} onClick={() => setRole('admin')}>👨‍🏫 老師管理後台</button>
        <button style={bigBtn} onClick={() => setRole('projector')}>📺 投影幕排行榜</button>
        <button style={bigBtn} onClick={() => setRole('player')}>📱 學生手機端</button>
      </div>
    );
  }

  // --- 角色分流 ---
  if (role === 'admin') return <AdminView roomData={roomData} inputText={inputText} setInputText={setInputText} gameMode={gameMode} setGameMode={setGameMode} handleCreateTeams={handleCreateTeams} handleStartMaster={handleStartMaster} />;
  if (role === 'projector') return <ProjectorView roomData={roomData} />;
  if (role === 'player') return <PlayerView roomData={roomData} />;
}

// --- 1. 老師管理介面 ---
function AdminView({ roomData, inputText, setInputText, gameMode, setGameMode, handleCreateTeams, handleStartMaster }) {
  return (
    <div style={layoutStyle}>
      <h2>老師控制台</h2>
      <div style={cardStyle}>
        <p>1. 選擇模式： 
          <select value={gameMode} onChange={(e) => setGameMode(e.target.value)}>
            <option value="simultaneous">全體同步比賽 (同一套題)</option>
            <option value="turn-based">輪流分組比賽 (不同題庫)</option>
          </select>
        </p>
        <textarea placeholder="貼上名單..." style={{width: '100%', height: '80px'}} value={inputText} onChange={(e) => setInputText(e.target.value)} />
        <button style={btnStyle} onClick={handleCreateTeams}>隨機分組並抽人</button>
      </div>
      
      {roomData?.state === 'TEAMS_READY' && (
        <button style={{...btnStyle, backgroundColor: '#f5222d', fontSize: '24px'}} onClick={handleStartMaster}>
          🚀 按此開始計時 (180秒)
        </button>
      )}
      <button onClick={() => update(ref(db, `rooms/${ROOM_ID}`), {state: 'LOBBY', teams: null})} style={{fontSize: '12px', marginTop: '20px'}}>重置所有資料</button>
    </div>
  );
}

// --- 2. 投影幕排行榜 (動態長條圖) ---
function ProjectorView({ roomData }) {
  const [timer, setTimer] = useState(180);

  useEffect(() => {
    let interval;
    if (roomData?.state === 'PLAYING' && roomData.timeLeft > 0) {
      interval = setInterval(() => {
        update(ref(db, `rooms/${ROOM_ID}`), { timeLeft: roomData.timeLeft - 1 });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [roomData?.state, roomData?.timeLeft]);

  const teams = roomData?.teams ? Object.values(roomData.teams) : [];
  const maxScore = Math.max(...teams.map(t => t.score), 10);

  return (
    <div style={{...layoutStyle, justifyContent: 'flex-start', paddingTop: '50px'}}>
      <div style={{fontSize: '48px', fontWeight: 'bold'}}>倒數計時：{roomData?.timeLeft}s</div>
      <div style={chartContainer}>
        {teams.map((t, i) => (
          <div key={i} style={chartRow}>
            <div style={teamLabel}>{t.name}<br/><small>{t.guesser}</small></div>
            <div style={barWrapper}>
              <div style={{...bar, width: `${(t.score / maxScore) * 80}%`}}>
                <span style={scoreLabel}>{t.score} 分</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {roomData?.state === 'ENDED' && <h1>🏁 遊戲結束！</h1>}
    </div>
  );
}

// --- 3. 學生手機端 ---
function PlayerView({ roomData }) {
  const [myTeamId, setMyTeamId] = useState(null);

  const handleScore = async (type) => {
    const team = roomData.teams[myTeamId];
    const nextIndex = team.currentIndex + 1;
    const currentQ = (roomData.config.mode === 'simultaneous' ? roomData.commonQueue : team.teamQueue)[team.currentIndex];
    
    const updates = {};
    updates[`rooms/${ROOM_ID}/teams/${myTeamId}/score`] = type === '正確' ? team.score + 1 : team.score;
    updates[`rooms/${ROOM_ID}/teams/${myTeamId}/currentIndex`] = nextIndex;
    const history = [...(team.history || []), { q: currentQ.term, type }];
    updates[`rooms/${ROOM_ID}/teams/${myTeamId}/history`] = history;

    update(ref(db), updates);
  };

  const joinTeam = async (tid) => {
    if (roomData.config.mode === 'turn-based') {
      // 輪流模式：加入時才幫該組抽題庫
      const snapshot = await get(ref(db, 'question_pool'));
      const pool = Object.values(snapshot.val()).sort(() => Math.random() - 0.5);
      update(ref(db, `rooms/${ROOM_ID}/teams/${tid}`), { teamQueue: pool });
    }
    setMyTeamId(tid);
  };

  if (!myTeamId) {
    return (
      <div style={layoutStyle}>
        <h3>選擇你的組別</h3>
        {roomData?.teams ? Object.entries(roomData.teams).map(([id, t]) => (
          <button key={id} style={bigBtn} onClick={() => joinTeam(id)}>{t.name} ({t.guesser})</button>
        )) : "等待老師分組中..."}
      </div>
    );
  }

  const team = roomData.teams[myTeamId];
  const queue = roomData.config.mode === 'simultaneous' ? roomData.commonQueue : team.teamQueue;
  const currentQ = queue ? queue[team.currentIndex] : null;

  if (roomData.state !== 'PLAYING') return <div style={layoutStyle}><h2>等待老師開始遊戲...</h2></div>;
  if (!currentQ) return <div style={layoutStyle}><h2>題目用完了！</h2></div>;

  return (
    <div style={{...layoutStyle, backgroundColor: '#1890ff', color: '#fff'}}>
      <h1 style={{fontSize: '48px'}}>{currentQ.term}</h1>
      <p>你是 {team.guesser}，加油！</p>
      <div style={{display: 'flex', gap: '20px', marginTop: '50px'}}>
        <button style={{...bigBtn, backgroundColor: '#52c41a'}} onClick={() => handleScore('正確')}>正確 ✅</button>
        <button style={{...bigBtn, backgroundColor: '#ff4d4f'}} onClick={() => handleScore('跳過')}>跳過 ⏩</button>
      </div>
    </div>
  );
}

// --- 樣式定義 ---
const layoutStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', textAlign: 'center', padding: '20px', fontFamily: 'system-ui' };
const bigBtn = { padding: '20px', fontSize: '20px', margin: '10px', borderRadius: '12px', border: 'none', color: '#fff', backgroundColor: '#1890ff', cursor: 'pointer', width: '250px' };
const btnStyle = { padding: '15px 30px', fontSize: '18px', margin: '10px', borderRadius: '8px', border: 'none', backgroundColor: '#52c41a', color: '#fff', cursor: 'pointer' };
const cardStyle = { backgroundColor: '#f0f2f5', padding: '20px', borderRadius: '12px', width: '90%', maxWidth: '500px', marginBottom: '20px' };
const chartContainer = { width: '80%', marginTop: '50px', textAlign: 'left' };
const chartRow = { display: 'flex', alignItems: 'center', marginBottom: '20px', height: '60px' };
const teamLabel = { width: '150px', fontSize: '20px', fontWeight: 'bold', textAlign: 'right', paddingRight: '20px' };
const barWrapper = { flex: 1, backgroundColor: '#eee', height: '40px', borderRadius: '20px', overflow: 'hidden', position: 'relative' };
const bar = { height: '100%', backgroundColor: '#1890ff', transition: 'width 0.5s ease-out', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '15px' };
const scoreLabel = { color: '#fff', fontWeight: 'bold' };