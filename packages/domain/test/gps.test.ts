import { describe, expect, it } from 'vitest';
import { GpsFilter, haversine, type GpsPoint } from '../src';

const START = Date.UTC(2026, 10, 2, 12);
function point(latitude: number, seconds: number, overrides: Partial<GpsPoint> = {}): GpsPoint {
  return { latitude, longitude: -46.63, accuracy: 5, timestamp: START + seconds * 1000, ...overrides };
}
function push(filter: GpsFilter, fix: GpsPoint) { return filter.push(fix, fix.timestamp); }

describe('filtro GPS puro; não substitui testes no aparelho', () => {
  it('calcula distância geodésica e cruza o antimeridiano pelo trecho curto', () => {
    expect(haversine({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111195, -1);
    expect(haversine({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 })).toBeCloseTo(222.39, 1);
    expect(() => haversine({ latitude: NaN, longitude: 0 }, { latitude: 0, longitude: 0 })).toThrow();
  });
  it('não inventa distância no primeiro fix e acumula movimento plausível', () => {
    const filter = new GpsFilter('walking');
    expect(push(filter, point(-23.55, 0))).toMatchObject({ accepted: true, reason: 'anchor', breakSegment: true, distanceMeters: 0 });
    const result = push(filter, point(-23.5499, 10));
    expect(result.accepted).toBe(true);
    expect(result.distanceMeters).toBeCloseTo(11.12, 1);
    expect(result.totalDistanceMeters).toBe(result.distanceMeters);
  });
  it('rejeita precisão ruim, pontos velhos e datas futuras sem conectar o trecho perdido', () => {
    const filter = new GpsFilter('running');
    push(filter, point(-23.55, 0));
    expect(push(filter, point(-23.5499, 10, { accuracy: 60 }))).toMatchObject({ accepted: false, reason: 'inaccurate', breakSegment: true });
    expect(push(filter, point(-23.5498, 20))).toMatchObject({ reason: 'anchor', distanceMeters: 0 });
    const old = point(-23.5497, 30);
    expect(filter.push(old, old.timestamp + 20_000).reason).toBe('stale');
    expect(filter.push(point(-23.5497, 50), START + 40_000).reason).toBe('stale');
    expect(filter.snapshot().totalDistanceMeters).toBe(0);
  });
  it('quebra o segmento quando o sinal falta mais de 30 segundos', () => {
    const filter = new GpsFilter('walking');
    push(filter, point(-23.55, 0));
    const result = push(filter, point(-23.54, 60));
    expect(result).toMatchObject({ accepted: true, reason: 'gap', breakSegment: true, distanceMeters: 0 });
    expect(push(filter, point(-23.5399, 70)).distanceMeters).toBeCloseTo(11.12, 1);
  });
  it('não soma a pausa e não liga posições distantes depois de retomar', () => {
    const filter = new GpsFilter('cycling');
    push(filter, point(-23.55, 0));
    push(filter, point(-23.549, 10));
    const before = filter.snapshot().totalDistanceMeters;
    filter.pause();
    expect(push(filter, point(-23.4, 20))).toMatchObject({ reason: 'paused', distanceMeters: 0 });
    filter.resume();
    expect(push(filter, point(-23.3, 30))).toMatchObject({ reason: 'anchor', distanceMeters: 0, breakSegment: true });
    expect(filter.snapshot().totalDistanceMeters).toBe(before);
  });
  it('rejeita salto implausível e usa o próximo ponto como nova âncora', () => {
    const filter = new GpsFilter('walking');
    push(filter, point(-23.55, 0));
    expect(push(filter, point(-23.0, 1))).toMatchObject({ reason: 'jump', accepted: false, breakSegment: true });
    expect(push(filter, point(-23.0001, 2))).toMatchObject({ reason: 'anchor', distanceMeters: 0 });
    expect(push(filter, point(-23.0002, 12)).distanceMeters).toBeCloseTo(11.12, 1);
    expect(filter.snapshot().totalDistanceMeters).toBeLessThan(12);
  });
  it('não soma jitter, mas permite acumular movimento real acima do limiar', () => {
    const filter = new GpsFilter('walking');
    push(filter, point(-23.55, 0));
    expect(push(filter, point(-23.549995, 5))).toMatchObject({ reason: 'jitter', accepted: false, distanceMeters: 0, breakSegment: false });
    expect(push(filter, point(-23.54999, 10)).reason).toBe('jitter');
    expect(push(filter, point(-23.54995, 15)).distanceMeters).toBeGreaterThan(5);
  });
  it('timestamps devem crescer; um ponto antigo não cria quilometragem extra', () => {
    const filter = new GpsFilter('walking');
    push(filter, point(-23.55, 10));
    expect(push(filter, point(-23.5499, 9))).toMatchObject({ reason: 'out_of_order', breakSegment: true });
    expect(push(filter, point(-23.5498, 20))).toMatchObject({ reason: 'anchor', distanceMeters: 0 });
    expect(filter.snapshot().totalDistanceMeters).toBe(0);
  });
  it('as velocidades plausíveis dependem da modalidade', () => {
    const walking = new GpsFilter('walking');
    const cycling = new GpsFilter('cycling');
    push(walking, point(-23.55, 0)); push(cycling, point(-23.55, 0));
    expect(push(walking, point(-23.549, 10)).reason).toBe('jump');
    expect(push(cycling, point(-23.549, 10)).reason).toBe('accepted');
  });
  it('snapshot preserva valores, mas retomada após lacuna não inventa caminho', () => {
    const original = new GpsFilter('running');
    push(original, point(-23.55, 0));
    push(original, point(-23.5499, 10));
    const snapshot = original.snapshot();
    const recovered = new GpsFilter('running');
    recovered.restore(snapshot);
    expect(push(recovered, point(-23.5, 100))).toMatchObject({ reason: 'gap', distanceMeters: 0 });
    expect(recovered.snapshot().totalDistanceMeters).toBe(snapshot.totalDistanceMeters);
    expect(() => recovered.restore({ ...snapshot, totalDistanceMeters: -1 })).toThrow();
    expect(() => new GpsFilter('cycling').restore(snapshot)).toThrow();
  });
  it('snapshot não permite alterar a âncora interna por referência', () => {
    const filter = new GpsFilter('running');
    push(filter, point(-23.55, 0));
    const snapshot = filter.snapshot();
    snapshot.anchor!.latitude = 70;
    expect(filter.snapshot().anchor!.latitude).toBe(-23.55);
  });
  it('reset inicia outra sessão sem reaproveitar quilômetros', () => {
    const filter = new GpsFilter('running');
    push(filter, point(-23.55, 0)); push(filter, point(-23.5499, 10));
    filter.reset();
    expect(filter.snapshot()).toMatchObject({ totalDistanceMeters: 0, anchor: null, paused: false });
  });
});
