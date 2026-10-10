import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:30000,workers:1,reporter:'list',
 use:{baseURL:'http://127.0.0.1:4173',headless:true,launchOptions:{...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']},screenshot:'only-on-failure'},
 webServer:{command:'node tools/serve-dist.mjs',url:'http://127.0.0.1:4173',reuseExistingServer:false},
});
