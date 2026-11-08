import {defineConfig} from 'vitest/config';
export default defineConfig({test:{fileParallelism:false,testTimeout:30000,hookTimeout:60000,pool:'forks',maxWorkers:1}});
