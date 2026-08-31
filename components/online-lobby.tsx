'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Radio, Swords, UserRound, Wifi, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LobbySnapshot, OnlineMatchSession, OnlineRoom, SignalMessage } from '@/lib/multiplayer-types';

type Props = {
  onBack: () => void;
  onPractice: () => void;
  onMatchStart: (session: OnlineMatchSession) => void;
};

async function multiplayerPost(body: Record<string, unknown>) {
  const response = await fetch('/api/multiplayer', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json() as { error?: string };
  if (!response.ok) throw new Error(data.error || '操作失败');
  return data;
}

export default function OnlineLobby({ onBack, onPractice, onMatchStart }: Props) {
  const [snapshot, setSnapshot] = useState<LobbySnapshot | null>(null);
  const [name, setName] = useState('街球玩家');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [channelReady, setChannelReady] = useState(false);
  const [readySent, setReadySent] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const stateChannelRef = useRef<RTCDataChannel | null>(null);
  const roomRef = useRef<OnlineRoom | null>(null);
  const meIdRef = useRef('');
  const lastSignalRef = useRef(0);
  const processedSignalsRef = useRef(new Set<number>());
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const handedOffRef = useRef(false);
  const lastControlDataAtRef = useRef(0);
  const lastRestartAtRef = useRef(0);
  const restartTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const saved = window.localStorage.getItem('unmatched-player-name');
    if (saved) window.setTimeout(() => setName(saved.slice(0, 18)), 0);
  }, []);

  const sendSignal = useCallback(async (type: SignalMessage['type'], payload: unknown) => {
    await multiplayerPost({ action: 'signal', type, payload: JSON.stringify(payload) });
  }, []);

  const updateChannelReady = useCallback(() => {
    // The reliable control channel also carries complete keyframes, so it is
    // sufficient to start and sustain a match when the low-latency channel is slow.
    setChannelReady(channelRef.current?.readyState === 'open');
  }, []);

  const bindChannel = useCallback((channel: RTCDataChannel) => {
    const isStateChannel = channel.label.startsWith('unmatched-state');
    if (isStateChannel) stateChannelRef.current = channel;
    else channelRef.current = channel;
    channel.onopen = () => {
      if (!isStateChannel) lastControlDataAtRef.current = Date.now();
      updateChannelReady();
    };
    channel.onclose = () => {
      updateChannelReady();
      if (isStateChannel && channelRef.current?.readyState === 'open') setError('');
      else setError('对手连接中断，正在重连…');
    };
    channel.onerror = () => {
      if (!(isStateChannel && channelRef.current?.readyState === 'open')) setError('网络波动，正在恢复连接…');
    };
    channel.addEventListener('message', () => {
      if (!isStateChannel) lastControlDataAtRef.current = Date.now();
      if (pcRef.current?.connectionState === 'connected') setError('');
    });
    updateChannelReady();
  }, [updateChannelReady]);

  const restartConnection = useCallback(async () => {
    const pc = pcRef.current;
    const room = roomRef.current;
    const meId = meIdRef.current;
    if (!pc || !room || !meId || Date.now() - lastRestartAtRef.current < 8_000) return;
    lastRestartAtRef.current = Date.now();
    try {
      if (room.hostId === meId) {
        pc.restartIce();
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        await sendSignal('offer', offer);
      } else {
        await sendSignal('restart', { requestedAt: Date.now() });
      }
    } catch {
      setError('正在重试对局连接…');
    }
  }, [sendSignal]);

  const setupPeer = useCallback(async (room: OnlineRoom, meId: string) => {
    if (pcRef.current) return;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 4,
    });
    pcRef.current = pc;
    pc.onicecandidate = (event) => { if (event.candidate) void sendSignal('ice', event.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        lastControlDataAtRef.current = Date.now();
        setError('');
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setError('网络波动，正在自动重连…');
        if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = window.setTimeout(() => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') void restartConnection();
        }, pc.connectionState === 'failed' ? 0 : 3_000);
      }
    };
    if (room.hostId === meId) {
      bindChannel(pc.createDataChannel('unmatched-control', { ordered: true }));
      bindChannel(pc.createDataChannel('unmatched-state', { ordered: false, maxPacketLifeTime: 180 }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal('offer', offer);
    } else {
      pc.ondatachannel = (event) => bindChannel(event.channel);
    }
  }, [bindChannel, restartConnection, sendSignal]);

  const applySignals = useCallback(async (signals: SignalMessage[]) => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const signal of signals) {
      if (processedSignalsRef.current.has(signal.id)) continue;
      const payload = JSON.parse(signal.payload) as RTCSessionDescriptionInit | RTCIceCandidateInit;
      if (signal.type === 'restart') {
        if (roomRef.current?.hostId === meIdRef.current) await restartConnection();
      } else if (signal.type === 'offer') {
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal('answer', answer);
      } else if (signal.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
      } else if (signal.type === 'ice') {
        if (pc.remoteDescription) {
          try { await pc.addIceCandidate(payload as RTCIceCandidateInit); }
          catch { queuedIceRef.current.push(payload as RTCIceCandidateInit); }
        }
        else queuedIceRef.current.push(payload as RTCIceCandidateInit);
      }
      if (pc.remoteDescription && queuedIceRef.current.length) {
        const queued = queuedIceRef.current.splice(0);
        for (const candidate of queued) {
          try { await pc.addIceCandidate(candidate); } catch { /* Ignore candidates from an older ICE generation. */ }
        }
      }
      processedSignalsRef.current.add(signal.id);
      lastSignalRef.current = Math.max(lastSignalRef.current, signal.id);
    }
  }, [restartConnection, sendSignal]);

  const closePeer = useCallback(() => {
    if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
    channelRef.current?.close();
    stateChannelRef.current?.close();
    pcRef.current?.close();
    channelRef.current = null;
    stateChannelRef.current = null;
    pcRef.current = null;
    roomRef.current = null;
    processedSignalsRef.current.clear();
    queuedIceRef.current = [];
    lastSignalRef.current = 0;
    handedOffRef.current = false;
    setReadySent(false);
    setChannelReady(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/multiplayer?since=${lastSignalRef.current}`, { cache: 'no-store' });
      const data = await response.json() as LobbySnapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || '大厅加载失败');
      const previousRoom = roomRef.current;
      if (previousRoom && (!data.room || data.room.id !== previousRoom.id)) closePeer();
      setSnapshot(data);
      meIdRef.current = data.me.id;
      roomRef.current = data.room;
      if (data.room) {
        await setupPeer(data.room, data.me.id);
        await applySignals(data.signals);
      }
      const channel = channelRef.current;
      const stateChannel = stateChannelRef.current;
      if (data.room?.status === 'playing' && channel?.readyState === 'open' && stateChannel && !handedOffRef.current) {
        handedOffRef.current = true;
        onMatchStart({ room: data.room, role: data.room.hostId === data.me.id ? 'host' : 'guest', channel, stateChannel });
      }
      if (!data.room) setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '大厅加载失败');
    }
  }, [applySignals, closePeer, onMatchStart, setupPeer]);

  useEffect(() => {
    void multiplayerPost({ action: 'heartbeat', name }).then(refresh).catch((reason) => setError(reason.message));
    const heartbeat = window.setInterval(() => { void multiplayerPost({ action: 'heartbeat', name }); }, 8_000);
    const poll = window.setInterval(() => { void refresh(); }, 650);
    const peerHeartbeat = window.setInterval(() => {
      const control = channelRef.current;
      if (!handedOffRef.current) return;
      if (control?.readyState === 'open') control.send(JSON.stringify({ type: 'heartbeat', at: Date.now() }));
      const now = Date.now();
      const controlStall = lastControlDataAtRef.current ? now - lastControlDataAtRef.current : 0;
      // Reliable keyframes already cover a stalled low-latency channel. Restart
      // ICE only when the reliable channel is silent too; never destroy a live
      // data channel, because a replacement would need a separate handoff.
      if (controlStall > 6_000) {
        setError('连接暂时中断，正在自动重连…');
        void restartConnection();
      }
    }, 1_000);
    return () => {
      window.clearInterval(heartbeat); window.clearInterval(poll); window.clearInterval(peerHeartbeat);
      if (restartTimerRef.current) window.clearTimeout(restartTimerRef.current);
      channelRef.current?.close(); stateChannelRef.current?.close(); pcRef.current?.close();
    };
  }, [name, refresh, restartConnection]);

  const act = async (key: string, operation: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await operation(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setBusy(''); }
  };

  const saveName = () => {
    const next = name.trim().slice(0, 18) || '街球玩家';
    setName(next); window.localStorage.setItem('unmatched-player-name', next);
    void act('name', () => multiplayerPost({ action: 'heartbeat', name: next }));
  };

  const room = snapshot?.room;
  if (room) {
    const opponent = room.hostId === snapshot?.me.id ? room.guestName : room.hostName;
    const myReady = room.hostId === snapshot?.me.id ? room.hostReady : room.guestReady;
    const theirReady = room.hostId === snapshot?.me.id ? room.guestReady : room.hostReady;
    return <>
      <div className="roomsTitle3d"><small>PRIVATE COURT · {room.code}</small><h2>真人单挑房</h2><p>对手：{opponent}</p></div>
      <div className="matchReady3d">
        <div className={myReady ? 'ready' : ''}><UserRound/><strong>{snapshot?.me.name}</strong><span>{myReady ? '已准备' : '等待准备'}</span></div>
        <b>VS</b>
        <div className={theirReady ? 'ready' : ''}><UserRound/><strong>{opponent}</strong><span>{theirReady ? '已准备' : '等待对手'}</span></div>
      </div>
      <div className="connection3d"><Wifi/><span>{channelReady ? '对局通道已连接' : '正在建立对局通道…'}</span></div>
      {error && <p className="lobbyError3d" role="alert">{error}</p>}
      <Button className="readyButton3d" disabled={!channelReady || readySent || myReady} onClick={() => void act('ready', async () => { await multiplayerPost({ action: 'ready' }); setReadySent(true); })}>
        {busy === 'ready' ? <LoaderCircle className="animate-spin"/> : <Check/>}{myReady ? '已准备，等待对手' : '我已准备'}
      </Button>
      <Button variant="ghost" onClick={() => void act('leave', async () => { await multiplayerPost({ action: 'leave' }); closePeer(); })}>退出房间</Button>
    </>;
  }

  return <>
    <div className="roomsTitle3d"><small>ONLINE LOBBY</small><h2>真人单挑</h2><p>选择一名在线玩家发起挑战</p></div>
    <div className="profileRow3d">
      <Input aria-label="玩家昵称" value={name} maxLength={18} onChange={(event) => setName(event.target.value)} onBlur={saveName}/>
      <Button variant="outline" onClick={saveName} disabled={busy === 'name'}>保存昵称</Button>
    </div>
    {snapshot?.invites.map((invite) => <div className="inviteToast3d" key={invite.id}>
      <Swords/><span><strong>{invite.fromName}</strong> 邀请你单挑</span>
      <Button size="icon" aria-label="接受邀请" onClick={() => void act(invite.id, () => multiplayerPost({ action: 'respond', inviteId: invite.id, accept: true }))}><Check/></Button>
      <Button size="icon" variant="ghost" aria-label="拒绝邀请" onClick={() => void act(invite.id, () => multiplayerPost({ action: 'respond', inviteId: invite.id, accept: false }))}><X/></Button>
    </div>)}
    <div className="onlinePlayers3d">
      <header><span><Radio/>在线玩家</span><b>{snapshot?.players.length ?? 0}</b></header>
      {!snapshot && <div className="lobbyEmpty3d"><LoaderCircle className="animate-spin"/><span>正在连接大厅…</span></div>}
      {snapshot && snapshot.players.length === 0 && <div className="lobbyEmpty3d"><UserRound/><span>暂时没有其他玩家，可在另一个浏览器打开本站测试</span></div>}
      {snapshot?.players.map((player) => <div className="onlinePlayer3d" key={player.id}>
        <i><UserRound/></i><span><strong>{player.name}</strong><small>空闲中</small></span>
        <Button size="sm" disabled={busy === player.id} onClick={() => void act(player.id, () => multiplayerPost({ action: 'invite', target: player.id }))}>
          {busy === player.id ? <LoaderCircle className="animate-spin"/> : <Swords/>}邀请
        </Button>
      </div>)}
    </div>
    {error && <p className="lobbyError3d" role="alert">{error}</p>}
    <div className="lobbyActions3d"><Button variant="outline" onClick={onPractice}>无对手练习</Button><Button variant="ghost" onClick={onBack}>← 返回主菜单</Button></div>
  </>;
}
