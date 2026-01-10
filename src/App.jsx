import React, { useState, useEffect, useRef } from 'react';
import { db } from './firebaseConfig';
import { ref, set, onValue, update, get } from "firebase/database";

const ROOM_ID = "ROOM_001"; 
const GAME_TIME = 180; 

export default function App() {
  const [role, setRole] = useState(null); 
  const [roomData, setRoomData] = useState(null);
  const roomDataRef = useRef(null);

  useEffect(() => {
    const roomRef = ref(db, `rooms/${ROOM_ID}`);
    return onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setRoomData(data);
        roomDataRef.current = data;
      } else {
        set(roomRef, { state: 'LOBBY', score: 0, timeLeft: GAME_TIME, sensor: { b: 0, base: 0 } });
      }
    });
  }, []);

  const startGame = async () => {
    const snapshot = await get(ref(db, 'question_pool'));
    if (!snapshot.exists()) return alert("請先匯入題庫！");
    let pool = Object.values(snapshot.val());
    const shuffled = pool.sort(() => Math.random() - 0.5);
    await update(ref(db, `rooms/${ROOM_ID}`), {
      state: 'PLAYING', queue: shuffled, currentIndex: 0,
      score: 0, history: [], timeLeft: GAME_TIME
    });
  };

  if (!role) {
    return (
      <div style={layoutStyle}>
        <h1 style={{color: '#1890ff', marginBottom: '40px'}}>台灣史「你講我猜」最終調校版</h1>
        <button style={bigBtn} onClick={() => setRole('projector')}>💻 我是投影幕</button>
        <button style={bigBtn} onClick={() => setRole('player')}>📱 我是猜題者</button>
      </div>
    );
  }

  return role === 'projector' ? 
    <ProjectorView roomData={roomData} startGame={startGame} /> : 
    <PlayerView roomDataRef={roomDataRef} />;
}

// --- 投影幕組件 ---
function ProjectorView({ roomData, startGame }) {
  useEffect(() => {
    let timer;
    if (roomData?.state === 'PLAYING' && roomData.timeLeft > 0) {
      timer = setInterval(() => {
        update(ref(db, `rooms/${ROOM_ID}`), { timeLeft: roomData.timeLeft - 1 });
      }, 1000);
    } else if (roomData?.timeLeft === 0 && roomData.state === 'PLAYING') {
      update(ref(db, `rooms/${ROOM_ID}`), { state: 'ENDED' });
    }
    return () => clearInterval(timer);
  }, [roomData?.state, roomData?.timeLeft]);

  if (!roomData || roomData.state === 'LOBBY') {
    return (
      <div style={layoutStyle}>
        <h1>準備開始遊戲</h1>
        <div style={sensorMonitor}>
          基準值: {roomData?.sensor?.base || 0} | 當前 Beta: {roomData?.sensor?.b || 0}
        </div>
        <button style={btnStyle} onClick={startGame}>開始新回合</button>
      </div>
    );
  }

  if (roomData.state === 'ENDED') {
    return (
      <div style={layoutStyle}>
        <h1>結束！得分：{roomData.score}</h1>
        <div style={historyBox}>{roomData.history?.map((h, i) => (<div key={i}>● {h.q} ({h.type})</div>))}</div>
        <button style={btnStyle} onClick={startGame}>再玩一局</button>
      </div>
    );
  }

  const currentQ = roomData.queue?.[roomData.currentIndex];
  const relative = (roomData.sensor?.b - roomData.sensor?.base) || 0;

  return (
    <div style={{ ...layoutStyle, backgroundColor: '#000', color: '#fff' }}>
      <div style={{ position: 'absolute', top: '20px', display: 'flex', gap: '30px', fontSize: '20px' }}>
        <span>時間：{roomData.timeLeft}s</span>
        <span>得分：{roomData.score}</span>
        <span style={{color: '#0f0'}}>基準: {roomData.sensor?.base} | 當前: {roomData.sensor?.b} | 相對: {relative.toFixed(1)}</span>
      </div>
      <h1 style={{ fontSize: '180px', margin: '20px 0' }}>{currentQ?.term}</h1>
      <p style={{ fontSize: '40px', color: '#888' }}>({currentQ?.category})</p>
    </div>
  );
}

// --- 手機猜題者組件 ---
function PlayerView({ roomDataRef }) {
  const [isGyroEnabled, setIsGyroEnabled] = useState(false);
  const [readyToTrigger, setReadyToTrigger] = useState(true);
  const [currentB, setCurrentB] = useState(0);
  
  const baseRef = useRef(0);
  const readyRef = useRef(true);
  const lastSyncRef = useRef(0);

  // 處理 0 與 -179 的角度跳轉數學
  const getDiff = (cur, ref) => {
    let d = cur - ref;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };

  const handleMotion = (e) => {
    const b = e.beta || 0;
    const now = Date.now();

    // 同步到 Firebase 供大螢幕監看
    if (now - lastSyncRef.current > 300) {
      update(ref(db, `rooms/${ROOM_ID}/sensor`), { b: b.toFixed(1) });
      lastSyncRef.current = now;
    }
    setCurrentB(b.toFixed(1));

    if (!isGyroEnabled) return;

    // 計算相對標準值的位移
    const diff = getDiff(b, baseRef.current);

    // 防呆中立區判定：只要在 -2 到 +2 之間，就恢復觸發資格
    if (Math.abs(diff) <= 2) {
      readyRef.current = true;
      setReadyToTrigger(true);
      return;
    }

    // 觸發判定
    const data = roomDataRef.current;
    if (!readyRef.current || !data || data.state !== 'PLAYING') return;

    if (diff < -3) { // 點頭得分
      submitAction('正確');
    } else if (diff > 2) { // 仰頭跳過
      submitAction('跳過');
    }
  };

  const submitAction = async (type) => {
    readyRef.current = false; // 鎖定直到回到中立區
    setReadyToTrigger(false);

    const data = roomDataRef.current;
    if (!data?.queue) return;

    const nextIndex = data.currentIndex + 1;
    const currentQ = data.queue[data.currentIndex];
    const newHistory = [...(data.history || []), { q: currentQ.term, type: type }];
    
    await update(ref(db, `rooms/${ROOM_ID}`), {
      currentIndex: nextIndex,
      score: type === '正確' ? data.score + 1 : data.score,
      history: newHistory,
      state: nextIndex >= data.queue.length ? 'ENDED' : 'PLAYING'
    });
  };

  const startGyro = () => {
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(s => {
        if (s === 'granted') {
          window.addEventListener('deviceorientation', handleMotion, true);
          // 紀錄當前角度為校正基準
          setTimeout(() => {
            const currentBeta = parseFloat(currentB);
            baseRef.current = currentBeta;
            update(ref(db, `rooms/${ROOM_ID}/sensor`), { base: currentBeta.toFixed(1) });
            setIsGyroEnabled(true);
          }, 500);
        }
      });
    } else {
      window.addEventListener('deviceorientation', handleMotion, true);
      setIsGyroEnabled(true);
    }
  };

  const data = roomDataRef.current;
  const currentQ = data?.queue?.[data?.currentIndex];

  return (
    <div style={{ ...layoutStyle, backgroundColor: readyToTrigger ? '#1890ff' : '#444', color: '#fff' }}>
      {!isGyroEnabled ? (
        <button style={btnStyle} onClick={startGyro}>啟動感應並校正</button>
      ) : (
        <div style={layoutStyle}>
          <h2 style={{fontSize: '40px'}}>{currentQ?.term || "等待開始"}</h2>
          <div style={{marginTop: '20px', fontSize: '18px'}}>
            相對基準位移: {(getDiff(currentB, baseRef.current)).toFixed(1)}°
          </div>
          <p style={{opacity: readyToTrigger ? 1 : 0.3}}>
            {readyToTrigger ? "手機放在額頭" : "請回正手機..."}
          </p>
          <div style={{marginTop: '40px', display: 'flex', gap: '20px'}}>
            <button style={smallBtn} onClick={() => submitAction('正確')}>手動正確</button>
            <button style={smallBtn} onClick={() => submitAction('跳過')}>手動跳過</button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- 樣式 ---
const layoutStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center', padding: '20px', overflow: 'hidden' };
const bigBtn = { padding: '25px 50px', fontSize: '24px', margin: '15px', borderRadius: '15px', border: 'none', backgroundColor: '#1890ff', color: '#fff', cursor: 'pointer' };
const btnStyle = { padding: '15px 40px', fontSize: '20px', borderRadius: '10px', cursor: 'pointer', border: 'none', backgroundColor: '#28a745', color: '#fff' };
const smallBtn = { padding: '15px 25px', fontSize: '16px', borderRadius: '8px', border: 'none', backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' };
const historyBox = { maxHeight: '40vh', overflowY: 'auto', backgroundColor: '#eee', padding: '20px', borderRadius: '10px', width: '80%', color: '#333' };
const sensorMonitor = { backgroundColor: '#333', color: '#0f0', padding: '10px', margin: '20px', borderRadius: '5px', fontFamily: 'monospace' };