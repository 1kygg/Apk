import type { RoutePoint } from './types';
const earth=6371000,rad=Math.PI/180;
function meters(a:RoutePoint,b:RoutePoint){
  const dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;
  const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;
  return earth*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function bearing(a:RoutePoint,b:RoutePoint){
  const lat1=a.latitude*rad,lat2=b.latitude*rad,dlon=(b.longitude-a.longitude)*rad;
  return Math.atan2(Math.sin(dlon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dlon));
}
/** Minimum spherical distance from a hidden endpoint to the rendered great-circle edge. */
function distanceToEdge(center:RoutePoint,a:RoutePoint,b:RoutePoint){
  const length=meters(a,b);
  if(length<0.001)return meters(center,a);
  const angular=meters(a,center)/earth,delta=bearing(a,center)-bearing(a,b);
  const cross=Math.asin(Math.max(-1,Math.min(1,Math.sin(angular)*Math.sin(delta))))*earth;
  const along=Math.atan2(Math.sin(angular)*Math.cos(delta),Math.cos(angular))*earth;
  return along>=0&&along<=length?Math.abs(cross):Math.min(meters(center,a),meters(center,b));
}
export function privateRouteSegments(points:RoutePoint[],hideEndpointsMeters=200):RoutePoint[][]{
  if(points.length<2)return[];
  if(!Number.isFinite(hideEndpointsMeters)||hideEndpointsMeters<0)throw new Error('Distância de ocultação inválida.');
  const first=points[0],last=points[points.length-1];
  const segments:RoutePoint[][]=[];let segment:RoutePoint[]=[];let originalSegment:number|undefined;
  function flush(){if(segment.length)segments.push(segment);segment=[];}
  for(const point of points){
    const hidden=hideEndpointsMeters>0&&(meters(point,first)<hideEndpointsMeters||meters(point,last)<hideEndpointsMeters);
    if(hidden){flush();originalSegment=undefined;continue;}
    const previous=segment[segment.length-1];
    const crossesHiddenRadius=hideEndpointsMeters>0&&previous&&(
      distanceToEdge(first,previous,point)<hideEndpointsMeters||distanceToEdge(last,previous,point)<hideEndpointsMeters
    );
    if((originalSegment!==undefined&&point.segment!==originalSegment)||crossesHiddenRadius)flush();
    segment.push(point);originalSegment=point.segment;
  }
  flush();return segments.filter(segment=>segment.length>=2);
}
function xml(value:string){const escaped:Record<string,string>={'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'};return value.replace(/[<>&"']/g,c=>escaped[c]);}
export function makeGpx(name:string,segments:RoutePoint[][]){
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Consta" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>'+xml(name)+'</name>'+
    segments.map(segment=>'<trkseg>'+segment.map(p=>'<trkpt lat="'+p.latitude.toFixed(7)+'" lon="'+p.longitude.toFixed(7)+'"/>').join('')+'</trkseg>').join('')+
    '</trk></gpx>';
}
