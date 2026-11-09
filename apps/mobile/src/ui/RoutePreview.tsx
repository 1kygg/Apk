import React, {useMemo} from 'react';
import {View} from 'react-native';
import Svg, {Circle, Polyline} from 'react-native-svg';
import type {RoutePoint} from '../lib/types';
import {Notice, Txt, useTheme} from './components';

/** A relative projection of recorded points, not a street map or a distance estimate. */
export function RoutePreview({points}: {points: RoutePoint[]}) {
  const {colors} = useTheme();
  const segments = useMemo(() => {
    const valid = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    if (!valid.length) return [];
    const anchor = valid[0];
    const scale = Math.max(.01, Math.cos(anchor.latitude * Math.PI / 180));
    const projected = valid.map(p => ({
      x: (((p.longitude - anchor.longitude + 540) % 360) - 180) * scale,
      y: -(p.latitude - anchor.latitude),
      segment: p.segment,
    }));
    const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, .00005);
    const groups: Array<Array<{x: number; y: number}>> = [];
    let lastSegment: number | undefined;
    for (const p of projected) {
      if (lastSegment !== p.segment || !groups.length) groups.push([]);
      groups[groups.length - 1].push({
        x: 160 + ((p.x - (minX + maxX) / 2) / span) * 180,
        y: 110 + ((p.y - (minY + maxY) / 2) / span) * 180,
      });
      lastSegment = p.segment;
    }
    return groups;
  }, [points]);

  if (!segments.length) return <Notice>Aguardando posições GPS válidas. O registro funciona sem internet, com a localização e o sinal do aparelho disponíveis.</Notice>;
  return <View style={{gap: 7}}>
    <Txt muted>Traçado do percurso, sem mapa de ruas</Txt>
    <View accessible accessibilityLabel="Traçado relativo dos pontos GPS. Pausas e falhas de sinal aparecem como trechos separados." style={{height: 220, backgroundColor: colors.surface, borderRadius: 12}}>
      <Svg width="100%" height="100%" viewBox="0 0 320 220">
        {segments.map((segment, index) => segment.length > 1
          ? <Polyline key={index} points={segment.map(p => p.x+','+p.y).join(' ')} fill="none" stroke={colors.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
          : <Circle key={index} cx={segment[0].x} cy={segment[0].y} r={3} fill={colors.accent}/>)}
      </Svg>
    </View>
    <Txt muted style={{fontSize: 13}}>Exibição dos pontos registrados neste celular. Não baixa mapas nem conecta lacunas do percurso.</Txt>
  </View>;
}
