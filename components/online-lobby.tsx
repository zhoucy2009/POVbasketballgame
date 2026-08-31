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
  const roomRef = useRef<OnlineRoom | null>(null);
  const meIdRef = useRef('');
  const lastSignalRef = useRef(0);
  const processedSignalsRef = useRef(new Set<number>());
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);
  const handedOffRef = useRef(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('unmatched-player-name');
    if (saved) window.setTimeout(() => setName(saved.slice(0, 18)), 0);
  }, []);

  const sendSignal = useCallback(async (type: SignalMessage['type'], payload: unknown) => {
    await multiplayerPost({ action: 'signal', type, payload: JSON.stringify(payload) });
  }, []);

  const bindChannel = useCallback((channel: RTCDataChannel) => {
    channelRef.current = channel;
    channel.onopen = () => setChannelReady(true);
    channel.onclose = () => setChannelReady(false);
    channel.onerror = () => setError('对手连接中断，正在重连');
  }, []);

  const setupPeer = useCallback(async (room: OnlineRoom, meId: string) => {
    if (pcRef.current) return;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
    });
    pcRef.current = pc;
    pc.onicecandidate = (event) => { if (event.candidate) void sendSignal('ice', event.candidate.toJSON()); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setError('无法建立对局连接，请重新进入房间');
    };
    if (room.hostId === meId) {
      const channel = pc.createDataChannel('unmatched-1v1', { ordered: true });
      bindChannel(channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal('offer', offer);
    } else {
      pc.ondatachannel = (event) => bindChannel(event.channel);
    }
  }, [bindChannel, sendSignal]);

  const applySignals = useCallback(async (signals: SignalMessage[]) => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const signal of signals) {
      if (processedSignalsRef.current.has(signal.id)) continue;
      processedSignalsRef.current.add(signal.id);
      lastSignalRef.current = Math.max(lastSignalRef.current, signal.id);
      const payload = JSON.parse(signal.payload) as RTCSessionDescriptionInit | RTCIceCandidateInit;
      if (signal.type === 'offer' && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal('answer', answer);
      } else if (signal.type === 'answer' && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
      } else if (signal.type === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(payload as RTCIceCandidateInit);
        else queuedIceRef.current.push(payload as RTCIceCandidateInit);
      }
      if (pc.remoteDescription && queuedIceRef.current.length) {
        const queued = queuedIceRef.current.splice(0);
        for (const candidate of queued) await pc.addIceCandidate(candidate);
      }
    }
  }, [sendSignal]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/multiplayer?since=${lastSignalRef.current}`, { cache: 'no-store' });
      const data = await response.json() as LobbySnapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || '大厅加载失败');
      setSnapshot(data);
      meIdRef.current = data.me.id;
      roomRef.current = data.room;
      if (data.room) {
        await setupPeer(data.room, data.me.id);
        await applySignals(data.signals);
      }
      const channel = channelRef.current;
      if (data.room?.status === 'playing' && channel?.readyState === 'open' && !handedOffRef.current) {
        handedOffRef.current = true;
        onMatchStart({ room: data.room, role: data.room.hostId === data.me.id ? 'host' : 'guest', channel });
      }
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '大厅加载失败');
    }
  }, [applySignals, onMatchStart, setupPeer]);

  useEffect(() => {
    void multiplayerPost({ action: 'heartbeat', name }).then(refresh).catch((reason) => setError(reason.message));
    const heartbeat = window.setInterval(() => { void multiplayerPost({ action: 'heartbeat', name }); }, 8_000);
    const poll = window.setInterval(() => { void refresh(); }, roomRef.current ? 650 : 1_800);
    return () => {
      window.clearInterval(heartbeat); window.clearInterval(poll);
      if (!handedOffRef.current) { channelRef.current?.close(); pcRef.current?.close(); }
    };
  }, [name, refresh]);

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
      <Button variant="ghost" onClick={() => void act('leave', async () => { await multiplayerPost({ action: 'leave' }); channelRef.current?.close(); pcRef.current?.close(); pcRef.current = null; setChannelReady(false); })}>退出房间</Button>
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
