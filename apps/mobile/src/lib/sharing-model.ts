import type { RoutePoint } from './types';
const earth=6371000;
function meters(a:RoutePoint,b:RoutePoint){
  const r=Math.PI/180,dlat=(b.latitude-a.latitude)*r,dlon=(b.longitude-a.longitude)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin(dlon/2)**2;
  return earth*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function privateRouteSegments(points:RoutePoint[],hideEndpointsMeters=200):RoutePoint[][]{
  if(points.length<2)return[];
  if(!Number.isFinite(hideEndpointsMeters)||hideEndpointsMeters<0)throw new Error('Distância de ocultação inválida.');
  const first=points[0],last=points[points.length-1];
  const segments:RoutePoint[][]=[];let segment:RoutePoint[]=[];let originalSegment:number|undefined;
  function flush(){if(segment.length)segments.push(segment);segment=[];}
  for(const point of points){
    const hidden=meters(point,first)<hideEndpointsMeters||meters(point,last)<hideEndpointsMeters;
    if(hidden){flush();originalSegment=undefined;continue;}
    if(originalSegment!==undefined&&point.segment!==originalSegment)flush();
    segment.push(point);originalSegment=point.segment;
  }
  flush();
  return segments.filter(segment=>segment.length>=2);
}
function xml(value:string){const escaped:Record<string,string>={'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'};return value.replace(/[<>&"']/g,c=>escaped[c]);}
export function makeGpx(name:string,segments:RoutePoint[][]){
  // No timestamps, names of participants or private endpoint coordinates in the export.
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Consta" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>'+xml(name)+'</name>'+
    segments.map(segment=>'<trkseg>'+segment.map(p=>'<trkpt lat="'+p.latitude.toFixed(7)+'" lon="'+p.longitude.toFixed(7)+'"/>').join('')+'</trkseg>').join('')+
    '</trk></gpx>';
}
