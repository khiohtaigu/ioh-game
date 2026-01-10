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
        set(roomRef, { state: 'LOBBY', score: 0, timeLeft: GAME_TIME, sensor: { b: 0, g: 0 } });
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
        <h1 style={{color: '#1890ff', marginBottom: '40px'}}>台灣史「你講我猜」v3.0</h1>
        <button style={bigBtn} onClick={() => setRole('projector')}>💻 我是投影幕</button>
        <button style={bigBtn} onClick={() => setRole('player')}>📱 我是猜題者</button>
      </div>
    );
  }

  return role === 'projector' ? 
    <ProjectorView roomData={roomData} startGame={startGame} /> : 
    <PlayerView roomDataRef={roomDataRef} />;
}

// --- 投影幕組件 (新增感應器監控) ---
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
          手機即時連線狀態：<br/>
          Beta: {roomData?.sensor?.b || 0} | Gamma: {roomData?.sensor?.g || 0}
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
  return (
    <div style={{ ...layoutStyle, backgroundColor: '#000', color: '#fff' }}>
      <div style={{ position: 'absolute', top: '20px', display: 'flex', gap: '50px', fontSize: '24px' }}>
        <span>時間：{roomData.timeLeft}s</span>
        <span>分數：{roomData.score}</span>
        <span style={{ color: '#0f0' }}>手機 Beta: {roomData.sensor?.b}</span>
      </div>
      <h1 style={{ fontSize: '180px', margin: '20px 0' }}>{currentQ?.term}</h1>
      <p style={{ fontSize: '40px', color: '#888' }}>主題：{currentQ?.category}</p>
    </div>
  );
}

// --- 手機猜題者組件 (新增同步功能) ---
function PlayerView({ roomDataRef }) {
  const [isGyroEnabled, setIsGyroEnabled] = useState(false);
  const [readyToTrigger, setReadyToTrigger] = useState(true);
  const [localAngles, setLocalAngles] = useState({ b: 0, g: 0 });
  
  const baseBetaRef = useRef(0);
  const readyRef = useRef(true);
  const lastUpdateRef = useRef(0);

  const getDiff = (cur, ref) => {
    let d = cur - ref;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };

  const handleMotion = (e) => {
    const b = e.beta || 0;
    const g = e.gamma || 0;
    const now = Date.now();

    // 每一秒同步一次數值到電腦大螢幕 (降低流量負荷)
    if (now - lastUpdateRef.current > 500) {
      update(ref(db, `rooms/${ROOM_ID}/sensor`), { b: b.toFixed(0), g: g.toFixed(0) });
      lastUpdateRef.current = now;
    }
    setLocalAngles({ b: b.toFixed(0), g: g.toFixed(0) });

    if (!isGyroEnabled) return;

    // 計算相對位移
    const diffB = getDiff(b, baseBetaRef.current);

    // 回正判定 (門檻設為 15 度)
    if (Math.abs(diffB) < 15) {
      readyRef.current = true;
      setReadyToTrigger(true);
      return;
    }

    // 觸發判定 (針對你的數據：仰角 81->75 = -6, 點頭 81->-70 = -151)
    // 發現兩者都是負向變動，這裡改用較靈敏的相對判定
    if (!readyRef.current || roomDataRef.current?.state !== 'PLAYING') return;

    // 點頭判定：向下大幅移動
    if (diffB < -40) {
      submitAction('正確');
    } 
    // 仰角判定：向上輕微移動 (你的數據顯示 81->75 只有 6 度差，我們設 5 度試試)
    else if (diffB > 0 && diffB < 15) { 
       // 這裡暫時維持原判斷，等你在大螢幕看到數值後我們再微調
    }
  };

  const submitAction = async (type) => {
    readyRef.current = false;
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
          setTimeout(() => {
            baseBetaRef.current = parseFloat(localAngles.b);
            setIsGyroEnabled(true);
          }, 1000);
        }
      });
    } else {
      window.addEventListener('deviceorientation', handleMotion, true);
      setIsGyroEnabled(true);
    }
  };

  return (
    <div style={{ ...layoutStyle, backgroundColor: readyToTrigger ? '#1890ff' : '#444', color: '#fff' }}>
      {!isGyroEnabled ? (
        <button style={btnStyle} onClick={startGyro}>啟動並同步感應器</button>
      ) : (
        <div style={layoutStyle}>
          <h2>{roomDataRef.current?.queue?.[roomDataRef.current?.currentIndex]?.term || "等待開始"}</h2>
          <div style={{marginTop: '20px'}}>Beta: {localAngles.b} | 基準: {baseBetaRef.current}</div>
          <div style={{marginTop: '40px', display: 'flex', gap: '20px'}}>
            <button style={smallBtn} onClick={() => submitAction('正確')}>正確</button>
            <button style={smallBtn} onClick={() => submitAction('跳過')}>跳過</button>
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
const smallBtn = { padding: '20px 30px', fontSize: '20px', borderRadius: '10px', border: 'none', backgroundColor: 'rgba(255,255,255,0.3)', color: '#fff' };
const historyBox = { maxHeight: '40vh', overflowY: 'auto', backgroundColor: '#eee', padding: '20px', borderRadius: '10px', width: '80%', color: '#333' };
const sensorMonitor = { backgroundColor: '#333', color: '#0f0', padding: '10px', margin: '20px', borderRadius: '5px', fontFamily: 'monospace' };