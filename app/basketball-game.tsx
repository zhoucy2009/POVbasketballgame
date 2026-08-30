'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'menu' | 'playing' | 'paused' | 'over';
type Team = 0 | 1;
type Player = { x:number; y:number; vx:number; vy:number; team:Team; number:number; name:string; color:string; ai:boolean };
type Shot = { fromX:number; fromY:number; toX:number; toY:number; t:number; duration:number; peak:number; success:boolean; team:Team; points:number };
type Ball = { x:number; y:number; z:number; owner:number; shot:Shot|null };
type Particle = { x:number; y:number; vx:number; vy:number; life:number; color:string };
type GameState = { players:Player[]; ball:Ball; score:[number,number]; time:number; charge:number; charging:boolean; aiCooldown:number; deadUntil:number; nextTeam:Team; particles:Particle[]; last:number; uiTick:number };

const W = 1200;
const H = 720;
const palettes = ['#55dcff','#a878ff','#ffca57'];

function makeState(color = palettes[0]): GameState {
  const players: Player[] = [
    {x:285,y:360,vx:0,vy:0,team:0,number:7,name:'YOU',color,ai:false},
    {x:225,y:225,vx:0,vy:0,team:0,number:11,name:'NOVA',color,ai:true},
    {x:225,y:505,vx:0,vy:0,team:0,number:23,name:'ACE',color,ai:true},
    {x:825,y:360,vx:0,vy:0,team:1,number:3,name:'RIVAL',color:'#ff536d',ai:true},
    {x:915,y:220,vx:0,vy:0,team:1,number:8,name:'BLAZE',color:'#ff536d',ai:true},
    {x:915,y:505,vx:0,vy:0,team:1,number:14,name:'ROOK',color:'#ff536d',ai:true},
  ];
  return {players,ball:{x:305,y:370,z:14,owner:0,shot:null},score:[0,0],time:90,charge:0,charging:false,aiCooldown:1.2,deadUntil:0,nextTeam:0,particles:[],last:0,uiTick:0};
}

function clamp(v:number,min:number,max:number){ return Math.max(min,Math.min(max,v)); }
function dist(a:{x:number;y:number},b:{x:number;y:number}){ return Math.hypot(a.x-b.x,a.y-b.y); }

export default function BasketballGame(){
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<Phase>('menu');
  const colorRef = useRef(palettes[0]);
  const soundRef = useRef(true);
  const keys = useRef<Record<string,boolean>>({});
  const stateRef = useRef<GameState>(makeState());
  const [phase,setPhase] = useState<Phase>('menu');
  const [score,setScore] = useState<[number,number]>([0,0]);
  const [time,setTime] = useState(90);
  const [charge,setCharge] = useState(0);
  const [teamColor,setTeamColor] = useState(palettes[0]);
  const [sound,setSound] = useState(true);
  const [flash,setFlash] = useState('');

  const tone = useCallback((freq:number,duration=.1)=>{
    if(!soundRef.current) return;
    try {
      const AudioCtx = window.AudioContext || (window as typeof window & {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
      const ac = new AudioCtx(); const o=ac.createOscillator(); const g=ac.createGain();
      o.frequency.value=freq; g.gain.setValueAtTime(.05,ac.currentTime); g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+duration);
      o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime+duration);
    } catch { /* audio is optional */ }
  },[]);

  const resetPossession = useCallback((team:Team)=>{
    const s=stateRef.current; const owner=team===0?0:3;
    s.players[0].x=285;s.players[0].y=360;s.players[1].x=225;s.players[1].y=225;s.players[2].x=225;s.players[2].y=505;
    s.players[3].x=825;s.players[3].y=360;s.players[4].x=915;s.players[4].y=220;s.players[5].x=915;s.players[5].y=505;
    s.ball.owner=owner;s.ball.shot=null;s.ball.z=14;s.deadUntil=0;s.nextTeam=team;s.aiCooldown=1.1;
  },[]);

  const launchShot = useCallback((owner:number,power:number)=>{
    const s=stateRef.current; if(s.ball.owner!==owner||s.ball.shot) return;
    const p=s.players[owner]; const team=p.team; const hoopX=team===0?1088:112; const hoopY=360;
    const d=Math.hypot(hoopX-p.x,hoopY-p.y); const ideal=clamp(.42+d/1500,.5,.84);
    const timing=Math.abs(power-ideal); const pressure=s.players.some((q,i)=>i!==owner&&q.team!==team&&dist(p,q)<72);
    const chance=clamp(.93-timing*1.55-d/2200-(pressure?.2:0),.18,.94);
    const success=Math.random()<chance; const points=d>430?3:2;
    s.ball.owner=-1;
    s.ball.shot={fromX:p.x,fromY:p.y-5,toX:hoopX,toY:hoopY,t:0,duration:clamp(.66+d/1200,.72,1.25),peak:115+d*.05,success,team,points};
    s.charge=0;s.charging=false;setCharge(0);tone(220,.06);
  },[tone]);

  const passOrSteal = useCallback(()=>{
    const s=stateRef.current;if(phaseRef.current!=='playing'||s.deadUntil) return;
    if(s.ball.owner===0){
      const mates=[1,2].sort((a,b)=>s.players[b].x-s.players[a].x);
      s.ball.owner=mates[0]; tone(380,.05); setFlash('漂亮传球'); setTimeout(()=>setFlash(''),650);
    } else if(s.ball.owner>=3 && dist(s.players[0],s.players[s.ball.owner])<72){
      if(Math.random()<.76){s.ball.owner=0;tone(620,.09);setFlash('抢断！');setTimeout(()=>setFlash(''),700);}
      else {setFlash('差一点');setTimeout(()=>setFlash(''),500);}
    }
  },[tone]);

  const startGame = useCallback(()=>{
    stateRef.current=makeState(colorRef.current);phaseRef.current='playing';setPhase('playing');setScore([0,0]);setTime(90);setCharge(0);setFlash('开球！');
    setTimeout(()=>setFlash(''),800);tone(520,.12);
  },[tone]);

  const setGamePhase=(next:Phase)=>{ phaseRef.current=next;setPhase(next); };

  useEffect(()=>{
    const down=(e:KeyboardEvent)=>{
      const k=e.key.toLowerCase();
      if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(k)) e.preventDefault();
      if(e.repeat) return; keys.current[k]=true;
      if(k===' '&&phaseRef.current==='playing'&&stateRef.current.ball.owner===0) stateRef.current.charging=true;
      if(k==='e') passOrSteal();
      if(k==='p'||k==='escape') setGamePhase(phaseRef.current==='playing'?'paused':phaseRef.current==='paused'?'playing':phaseRef.current);
    };
    const up=(e:KeyboardEvent)=>{const k=e.key.toLowerCase();keys.current[k]=false;if(k===' '&&stateRef.current.charging)launchShot(0,stateRef.current.charge);};
    window.addEventListener('keydown',down,{passive:false});window.addEventListener('keyup',up);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};
  },[launchShot,passOrSteal]);

  useEffect(()=>{
    let raf=0;
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    canvas.width=W;canvas.height=H;

    const moveToward=(p:Player,tx:number,ty:number,speed:number,dt:number)=>{
      const dx=tx-p.x,dy=ty-p.y,d=Math.hypot(dx,dy)||1;p.vx=dx/d*speed;p.vy=dy/d*speed;
      if(d<speed*dt){p.x=tx;p.y=ty;}else{p.x+=p.vx*dt;p.y+=p.vy*dt;}
    };
    const scoreShot=(team:Team,points:number,now:number)=>{
      const s=stateRef.current;s.score[team]+=points;s.nextTeam=(team===0?1:0);s.deadUntil=now+1.25;
      for(let i=0;i<34;i++)s.particles.push({x:team===0?1065:135,y:335,vx:(Math.random()-.5)*180,vy:-Math.random()*180-30,life:1,color:i%2?'#ff9b39':'#fff'});
      setScore([...s.score] as [number,number]);setFlash(points===3?'三分命中！':'命中！');setTimeout(()=>setFlash(''),950);tone(820,.18);
    };
    const update=(dt:number,now:number)=>{
      const s=stateRef.current;if(phaseRef.current!=='playing')return;
      s.time=Math.max(0,s.time-dt);s.aiCooldown-=dt;
      if(s.time<=0){phaseRef.current='over';setPhase('over');return;}
      if(s.deadUntil){ if(now>=s.deadUntil)resetPossession(s.nextTeam); return; }
      const me=s.players[0];let dx=0,dy=0;
      if(keys.current.w||keys.current.arrowup)dy--;if(keys.current.s||keys.current.arrowdown)dy++;if(keys.current.a||keys.current.arrowleft)dx--;if(keys.current.d||keys.current.arrowright)dx++;
      const mag=Math.hypot(dx,dy)||1;const speed=keys.current.shift?242:178;me.vx=dx/mag*speed;me.vy=dy/mag*speed;me.x+=me.vx*dt;me.y+=me.vy*dt;
      me.x=clamp(me.x,135,1065);me.y=clamp(me.y,135,585);
      const owner=s.ball.owner;const possession=owner>=0?s.players[owner].team:null;
      s.players.forEach((p,i)=>{
        if(i===0)return;
        let tx=p.x,ty=p.y,spd=118;
        if(owner===i){tx=p.team===0?960:240;ty=360+(p.number%2?65:-65);spd=136;if(Math.abs(tx-p.x)<95&&s.aiCooldown<=0){launchShot(i,.68+Math.random()*.12);s.aiCooldown=2.3;return;}}
        else if(possession===p.team){
          const slots=p.team===0?[[750,210],[760,515],[650,360]]:[[450,210],[440,515],[550,360]];const slot=slots[i%3];tx=slot[0];ty=slot[1];
        } else if(possession!==null){const mark=s.players[p.team===0?i+3:i-3];tx=mark.x+(p.team===0?-42:42);ty=mark.y;spd=132;}
        else {tx=s.ball.x;ty=s.ball.y;spd=145;}
        moveToward(p,clamp(tx,135,1065),clamp(ty,135,585),spd,dt);
      });
      if(s.charging&&s.ball.owner===0){s.charge+=dt*.78;if(s.charge>1)s.charge=.25;}
      if(s.ball.shot){
        const sh=s.ball.shot;sh.t+=dt/sh.duration;const t=Math.min(1,sh.t),arc=Math.sin(Math.PI*t);
        s.ball.x=sh.fromX+(sh.toX-sh.fromX)*t;s.ball.y=sh.fromY+(sh.toY-sh.fromY)*t;s.ball.z=14+arc*sh.peak;
        if(t>=1){
          s.ball.shot=null;s.ball.z=0;
          if(sh.success)scoreShot(sh.team,sh.points,now);
          else{s.ball.x=sh.toX+(sh.team===0?-58:58);s.ball.y=sh.toY+(Math.random()-.5)*100;s.ball.owner=-1;setFlash('篮板！');setTimeout(()=>setFlash(''),500);}
        }
      } else if(s.ball.owner>=0){const p=s.players[s.ball.owner];const dir=p.team===0?1:-1;s.ball.x=p.x+dir*24;s.ball.y=p.y+14;s.ball.z=10+Math.abs(Math.sin(now*9))*15;}
      else {
        s.ball.z=0;let nearest=-1,nd=999;
        s.players.forEach((p,i)=>{const d=dist(p,s.ball);if(d<nd){nd=d;nearest=i;}});
        if(nearest>=0&&nd<35){s.ball.owner=nearest;tone(300,.05);}
      }
      if(owner>=0&&!s.ball.shot){s.players.forEach((p,i)=>{if(i!==owner&&p.team!==s.players[owner].team&&dist(p,s.players[owner])<34&&Math.random()<dt*.16){s.ball.owner=i;setFlash('球权转换');setTimeout(()=>setFlash(''),500);}});}
      s.particles=s.particles.filter(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.life-=dt;return p.life>0;});
      s.uiTick+=dt;if(s.uiTick>.08){s.uiTick=0;setTime(s.time);setCharge(s.charge);}
    };

    const rounded=(x:number,y:number,w:number,h:number,r:number)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);};
    const drawCourt=()=>{
      const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#182b40');g.addColorStop(.18,'#356b83');g.addColorStop(.181,'#202c35');g.addColorStop(.255,'#20262c');g.addColorStop(.256,'#ad653a');g.addColorStop(1,'#ce8650');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#0b111bbd';ctx.fillRect(0,0,W,70);ctx.fillStyle='#ffffff10';for(let x=0;x<W;x+=54)ctx.fillRect(x,0,2,70);
      ctx.font='900 17px Arial';ctx.letterSpacing='5px';ctx.fillStyle='#ffffffc9';ctx.fillText('NIGHT LEAGUE',40,43);ctx.fillStyle='#ff9a3c';ctx.fillText('PLAY LOUD',1014,43);
      ctx.save();rounded(55,92,1090,570,10);ctx.clip();
      for(let x=55;x<1145;x+=44){ctx.fillStyle=(Math.floor((x-55)/44)%2?'#c77a46':'#d0864e');ctx.fillRect(x,92,44,570);ctx.fillStyle='#5b2c161d';ctx.fillRect(x+42,92,2,570);}
      ctx.strokeStyle='#fffde8';ctx.lineWidth=4;ctx.strokeRect(75,112,1050,530);ctx.beginPath();ctx.moveTo(600,112);ctx.lineTo(600,642);ctx.stroke();ctx.beginPath();ctx.arc(600,377,78,0,Math.PI*2);ctx.stroke();
      ctx.strokeRect(75,257,180,240);ctx.strokeRect(945,257,180,240);ctx.beginPath();ctx.arc(255,377,78,-Math.PI/2,Math.PI/2);ctx.stroke();ctx.beginPath();ctx.arc(945,377,78,Math.PI/2,Math.PI*1.5);ctx.stroke();
      ctx.beginPath();ctx.arc(112,377,310,-1.02,1.02);ctx.stroke();ctx.beginPath();ctx.arc(1088,377,310,Math.PI-1.02,Math.PI+1.02);ctx.stroke();
      ctx.globalAlpha=.11;ctx.fillStyle='#111';ctx.font='italic 900 84px Arial';ctx.textAlign='center';ctx.fillText('UNMATCHED',600,405);ctx.globalAlpha=1;ctx.restore();
      const hoop=(x:number,flip:boolean)=>{ctx.strokeStyle='#eef4f6';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(x+(flip?22:-22),315);ctx.lineTo(x+(flip?22:-22),439);ctx.stroke();ctx.lineWidth=5;ctx.strokeRect(x+(flip?-3:-38),325,40,102);ctx.strokeStyle='#ff6b2c';ctx.lineWidth=7;ctx.beginPath();ctx.ellipse(x,377,22,8,0,0,Math.PI*2);ctx.stroke();};hoop(112,false);hoop(1088,true);
    };
    const drawPlayer=(p:Player,i:number)=>{
      const selected=i===0;ctx.save();ctx.translate(p.x,p.y);
      ctx.fillStyle='#0000003d';ctx.beginPath();ctx.ellipse(0,22,29,12,0,0,Math.PI*2);ctx.fill();
      if(selected){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,24,35,17,0,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(-7,-48);ctx.lineTo(7,-48);ctx.lineTo(0,-37);ctx.fill();}
      ctx.strokeStyle='#221916';ctx.lineWidth=9;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-13,12);ctx.lineTo(-17,31);ctx.moveTo(13,12);ctx.lineTo(17,31);ctx.stroke();
      ctx.fillStyle=p.color;ctx.shadowColor=p.color;ctx.shadowBlur=selected?18:5;ctx.beginPath();ctx.arc(0,0,25,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      ctx.fillStyle='#13202b';ctx.beginPath();ctx.arc(0,-25,15,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f1ba92';ctx.beginPath();ctx.arc(0,-21,12,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#0c1118';ctx.font='900 13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.number),0,2);
      if(stateRef.current.ball.owner===i){ctx.fillStyle='#ffffffd8';rounded(-26,39,52,17,8);ctx.fill();ctx.fillStyle='#111';ctx.font='800 9px Arial';ctx.fillText(p.name,0,48);}
      ctx.restore();
    };
    const drawBall=(s:GameState)=>{const b=s.ball;ctx.fillStyle='#0005';ctx.beginPath();ctx.ellipse(b.x,b.y+17,13+Math.min(b.z/14,9),6,0,0,Math.PI*2);ctx.fill();const yy=b.y-b.z*.62;const r=13;const bg=ctx.createRadialGradient(b.x-4,yy-5,2,b.x,yy,r);bg.addColorStop(0,'#ffc16e');bg.addColorStop(.55,'#ef7d24');bg.addColorStop(1,'#873807');ctx.fillStyle=bg;ctx.beginPath();ctx.arc(b.x,yy,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#4a220f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(b.x,yy,r*.9,-1.1,1.1);ctx.moveTo(b.x-r,yy);ctx.lineTo(b.x+r,yy);ctx.moveTo(b.x,yy-r);ctx.quadraticCurveTo(b.x-5,yy,b.x,yy+r);ctx.stroke();};
    const draw=()=>{const s=stateRef.current;drawCourt();[...s.players].map((p,i)=>({p,i})).sort((a,b)=>a.p.y-b.p.y).forEach(({p,i})=>drawPlayer(p,i));drawBall(s);s.particles.forEach(p=>{ctx.globalAlpha=p.life;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,6,6);});ctx.globalAlpha=1;};
    const loop=(stamp:number)=>{const s=stateRef.current;const now=stamp/1000;const dt=Math.min(.032,s.last?now-s.last:.016);s.last=now;update(dt,now);draw();raf=requestAnimationFrame(loop);};
    raf=requestAnimationFrame(loop);return()=>cancelAnimationFrame(raf);
  },[launchShot,resetPossession,tone]);

  const hold=(key:string,on:boolean)=>{keys.current[key]=on;};
  const beginShot=()=>{if(phaseRef.current==='playing'&&stateRef.current.ball.owner===0)stateRef.current.charging=true;};
  const endShot=()=>{if(stateRef.current.charging)launchShot(0,stateRef.current.charge);};
  const colorPick=(color:string)=>{colorRef.current=color;setTeamColor(color);stateRef.current.players.slice(0,3).forEach(p=>p.color=color);};
  const clock=`${Math.floor(time/60)}:${String(Math.ceil(time%60)).padStart(2,'0')}`;

  return <main className="basketball-game">
    <canvas ref={canvasRef} aria-label="3 对 3 街头篮球比赛画面" />
    <header className={`hud ${phase==='menu'?'hud-dim':''}`}>
      <div className="team-score home"><span>HOME</span><strong>{score[0]}</strong></div><div className="game-clock">{clock}</div><div className="team-score away"><strong>{score[1]}</strong><span>AWAY</span></div>
    </header>
    {flash&&<div className="game-flash">{flash}</div>}
    {phase==='playing'&&<><button className="icon-action pause-action" aria-label="暂停" onClick={()=>setGamePhase('paused')}>Ⅱ</button><div className="desktop-hints"><span><kbd>WASD</kbd> 移动</span><span><kbd>Shift</kbd> 冲刺</span><span><kbd>E</kbd> 传球 / 抢断</span><span><kbd>Space</kbd> 蓄力投篮</span></div>{stateRef.current.charging&&<div className="shot-meter"><span>投篮力度</span><i><b style={{width:`${charge*100}%`}}/></i><em style={{left:'66%'}}/></div>}</>}
    {phase==='menu'&&<section className="lobby-panel"><div className="brand-mark"><span>UNMATCHED</span><strong>HOOPS</strong></div><p className="mode-label">STREETBALL · 3V3</p><h1>统治<br/>这片球场。</h1><p className="lobby-copy">带球突破、呼叫传球、抢断防守。90 秒内，打出属于你的高光回合。</p><div className="kit-row"><span>选择球衣</span><div>{palettes.map(c=><button key={c} aria-label={`选择 ${c} 球衣`} className={teamColor===c?'active':''} style={{background:c}} onClick={()=>colorPick(c)}/>)}</div></div><button className="play-button" onClick={startGame}><span>快速比赛</span><b aria-hidden>▶</b></button><div className="feature-row"><span>⚡ 快节奏</span><span>◆ AI 队友</span></div></section>}
    {(phase==='paused'||phase==='over')&&<section className="pause-panel"><p>{phase==='over'?'比赛结束':'比赛暂停'}</p><h2>{phase==='over'?(score[0]===score[1]?'平局！':score[0]>score[1]?'你赢了！':'再来一场？'):'喘口气。'}</h2>{phase==='over'&&<div className="final-score">{score[0]} <span>:</span> {score[1]}</div>}<button onClick={phase==='paused'?()=>setGamePhase('playing'):startGame}>{phase==='paused'?<>▶ 继续比赛</>:<>↻ 重新开球</>}</button><button className="secondary" onClick={()=>setGamePhase('menu')}>返回主菜单</button></section>}
    <button className="icon-action sound-action" aria-label={sound?'关闭声音':'开启声音'} onClick={()=>{soundRef.current=!sound;setSound(!sound)}}>{sound?'♬':'×'}</button>
    {phase==='playing'&&<div className="touch-controls"><div className="dpad"><button onPointerDown={()=>hold('w',true)} onPointerUp={()=>hold('w',false)} onPointerCancel={()=>hold('w',false)}>▲</button><button onPointerDown={()=>hold('a',true)} onPointerUp={()=>hold('a',false)} onPointerCancel={()=>hold('a',false)}>◀</button><button onPointerDown={()=>hold('s',true)} onPointerUp={()=>hold('s',false)} onPointerCancel={()=>hold('s',false)}>▼</button><button onPointerDown={()=>hold('d',true)} onPointerUp={()=>hold('d',false)} onPointerCancel={()=>hold('d',false)}>▶</button></div><div className="touch-actions"><button className="pass" onPointerDown={passOrSteal}>传 / 抢</button><button className="shoot" onPointerDown={beginShot} onPointerUp={endShot} onPointerCancel={endShot}>投篮</button></div></div>}
  </main>;
}
