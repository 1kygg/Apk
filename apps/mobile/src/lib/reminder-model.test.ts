import {describe,it,expect} from 'vitest';
import {isQuietTime} from './reminder-model';
describe('personal reminders quiet hours',()=>{
  it('handles quiet hours crossing midnight',()=>{
    expect(isQuietTime(23,0,'22:00','07:00')).toBe(true);
    expect(isQuietTime(6,59,'22:00','07:00')).toBe(true);
    expect(isQuietTime(7,0,'22:00','07:00')).toBe(false);
    expect(isQuietTime(12,0,'22:00','07:00')).toBe(false);
  });
  it('handles same-day interval and disabled quiet hours',()=>{
    expect(isQuietTime(13,0,'12:00','14:00')).toBe(true);
    expect(isQuietTime(14,0,'12:00','14:00')).toBe(false);
    expect(isQuietTime(13,0)).toBe(false);
  });
  it('rejects invalid HH:mm',()=>{expect(()=>isQuietTime(12,0,'25:00','07:00')).toThrow();});
});
