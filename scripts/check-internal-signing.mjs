import { readFileSync } from 'node:fs';
const gradle = readFileSync('app/build.gradle', 'utf8');
const release = gradle.match(/release\s*\{([\s\S]*?)signingConfig\s+signingConfigs\.([A-Za-z0-9_]+)/);
if (!release || release[2] !== 'debug') {
  throw new Error('Build interno exige release com signingConfigs.debug. Revise o template nativo; não altere assinatura de produção automaticamente.');
}
