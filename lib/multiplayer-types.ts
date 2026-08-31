export type PlayerPresence = {
  id: string;
  name: string;
  status: 'online' | 'invited' | 'in_room' | 'playing';
  lastSeen: number;
};

export type GameInvite = {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  expiresAt: number;
};

export type OnlineRoom = {
  id: string;
  code: string;
  hostId: string;
  guestId: string;
  hostName: string;
  guestName: string;
  hostReady: boolean;
  guestReady: boolean;
  status: 'waiting' | 'playing' | 'finished';
};

export type SignalMessage = {
  id: number;
  fromId: string;
  type: 'offer' | 'answer' | 'ice' | 'restart';
  payload: string;
};

export type LobbySnapshot = {
  me: PlayerPresence;
  players: PlayerPresence[];
  invites: GameInvite[];
  room: OnlineRoom | null;
  signals: SignalMessage[];
  serverTime: number;
};

export type OnlineMatchSession = {
  room: OnlineRoom;
  role: 'host' | 'guest';
  channel: RTCDataChannel;
  stateChannel: RTCDataChannel;
};
