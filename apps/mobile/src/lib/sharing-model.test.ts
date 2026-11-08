import {describe,it,expect} from 'vitest';
import {makeGpx,privateRouteSegments} from './sharing-model';
import type {RoutePoint} from './types';
function point(latitude:number,segment=0):RoutePoint{return{latitude,longitude:0,accuracy:5,timestamp:latitude*100000,segment};}
describe('private route sharing',()=>{
  it('removes both endpoint radii including later returns into them',()=>{
    const route=[0,.001,.003,.004,.001,.004,.005,.006,.008,.009].map(x=>point(x));
    const segments=privateRouteSegments(route,200);
    expect(segments.flat().every(p=>p.latitude>=.003&&p.latitude<=.006)).toBe(true);
    expect(segments.map(s=>s.map(p=>p.latitude))).toEqual([[.003,.004],[.004,.005,.006]]);
  });
  it('never bridges pause segments',()=>{
    expect(privateRouteSegments([point(0,0),point(.001,0),point(.002,1),point(.003,1)],0).map(s=>s.length)).toEqual([2,2]);
  });
  it('can return no route when hiding endpoints leaves too few points',()=>{
    expect(privateRouteSegments([point(0),point(.001)],200)).toEqual([]);
  });
  it('exports valid escaped GPX without timestamps or endpoint metadata',()=>{
    const xml=makeGpx('Corrida & caminhada',[[point(.01),point(.02)]]);
    expect(xml).toContain('Corrida &amp; caminhada');expect(xml).not.toContain('<time>');
    expect(xml.match(/<trkseg>/g)).toHaveLength(1);expect(xml).toContain('<trkpt lat="0.0100000"');
  });
});

describe('hidden endpoint edges',()=>{
  it('breaks a visible edge that crosses the hidden start circle',()=>{
    const route=[0,.003,.004,-.003,-.004,.020,.021].map(x=>point(x));
    const segments=privateRouteSegments(route,200);
    expect(segments.some(s=>s.some(p=>p.latitude>0)&&s.some(p=>p.latitude<0))).toBe(false);
    expect(segments.map(s=>s.map(p=>p.latitude))).toContainEqual([.003,.004]);
    expect(segments.map(s=>s.map(p=>p.latitude))).toContainEqual([-.003,-.004]);
  });
});
