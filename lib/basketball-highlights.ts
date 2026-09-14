export type HighlightKind = 'score' | 'block' | 'teamwork';
export type HighlightFrame = { time: number; pose: Float32Array };
export type HighlightClip = {
  kind: HighlightKind;
  label: string;
  actor: number;
  eventTime: number;
  end: number;
  frames: HighlightFrame[];
};

// Retain a short lead-in and four recent moments per category, even in
// unlimited overtime. Frames shared by overlapping clips are stored once.
export class HighlightRecorder {
  private recent: HighlightFrame[] = [];
  private clips: HighlightClip[] = [];
  add(frame: HighlightFrame) {
    if (this.recent.at(-1)?.time === frame.time) this.recent[this.recent.length - 1] = frame;
    else this.recent.push(frame);
    while (this.recent.length && this.recent[0].time < frame.time - 5) this.recent.shift();
    for (const clip of this.clips) {
      if (frame.time <= clip.end) {
        if (clip.frames.at(-1)?.time === frame.time) clip.frames[clip.frames.length - 1] = frame;
        else if (frame.time > (clip.frames.at(-1)?.time ?? -1)) clip.frames.push(frame);
      }
    }
  }
  mark(kind: HighlightKind, label: string, actor: number, time: number) {
    this.clips.push({ kind, label, actor, eventTime: time, end: time + 1,
      frames: this.recent.filter(frame => frame.time >= time - 4) });
    const matching = this.clips.filter(clip => clip.kind === kind);
    if (matching.length > 4) this.clips.splice(this.clips.indexOf(matching[0]), 1);
  }
  finish() { return this.clips.filter(clip => clip.frames.length > 0); }
  clear() { this.recent = []; this.clips = []; }
}

export function matchDecision(mode: string, time: number, score: readonly [number, number], overtime: boolean) {
  if (mode === 'practice') return 'playing';
  if (overtime) return score[0] === score[1] ? 'overtime' : 'finished';
  if (time > 0) return 'playing';
  return score[0] === score[1] ? 'overtime' : 'finished';
}
