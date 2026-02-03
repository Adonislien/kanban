require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

// 詳細日誌中間件
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const TOKEN_PATH = path.join(__dirname, 'token.json');
const ONEDRIVE_PATH = '/Kanban/data.json';

// 啟動前檢查環境變數
const REQUIRED_VARS = ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'];
const missingVars = REQUIRED_VARS.filter(v => !process.env[v]);
if (missingVars.length > 0) {
    console.error('❌ 缺少必要的環境變數:', missingVars.join(', '));
} else {
    console.log('✅ 環境變數檢查通過');
}

async function getAccessToken() {
    let tokenData;
    
    if (fs.existsSync(TOKEN_PATH)) {
        tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    } else if (process.env.REFRESH_TOKEN) {
        console.log('正在從 REFRESH_TOKEN 環境變數初始化...');
        tokenData = {
            refresh_token: process.env.REFRESH_TOKEN,
            expiry: 0
        };
    } else {
        throw new Error('No token source available');
    }

    if (Date.now() > (tokenData.expiry - 300000)) {
        console.log('正在刷新 Access Token...');
        try {
            const response = await axios.post(`https://login.microsoftonline.com/${process.env.TENANT_ID || 'common'}/oauth2/v2.0/token`, new URLSearchParams({
                client_id: process.env.CLIENT_ID,
                client_secret: process.env.CLIENT_SECRET,
                refresh_token: tokenData.refresh_token,
                grant_type: 'refresh_token'
            }));
            
            tokenData = {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token || tokenData.refresh_token,
                expiry: Date.now() + (response.data.expires_in * 1000)
            };
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
            console.log('✅ Token 刷新成功');
        } catch (error) {
            console.error('❌ Token 刷新失敗:', error.response ? JSON.stringify(error.response.data) : error.message);
            throw error;
        }
    }
    return tokenData.access_token;
}

// 健康檢查介面
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        env: {
            hasClientId: !!process.env.CLIENT_ID,
            hasClientSecret: !!process.env.CLIENT_SECRET,
            hasRefreshToken: !!process.env.REFRESH_TOKEN
        }
    });
});

// 接收前端日誌
app.post('/api/logs', (req, res) => {
    console.log(`[FRONTEND LOG] ${JSON.stringify(req.body)}`);
    res.sendStatus(200);
});

app.get('/api/board', async (req, res) => {
    try {
        const token = await getAccessToken();
        console.log('正在從 OneDrive 讀取資料...');
        const response = await axios.get(`https://graph.microsoft.com/v1.0/me/drive/root:${ONEDRIVE_PATH}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const downloadRes = await axios.get(response.data['@microsoft.graph.downloadUrl']);
        res.json({
            etag: response.data['@odata.etag'],
            data: downloadRes.data
        });
    } catch (error) {
        console.error('API Error (GET /api/board):', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/board', async (req, res) => {
    try {
        const token = await getAccessToken();
        console.log('正在將資料存入 OneDrive...');
        
        // 優先從 body 抓取，其次從 Header 抓取
        const content = req.body.data || req.body;
        const etag = req.body.etag || req.headers['if-match'];

        const response = await axios.put(`https://graph.microsoft.com/v1.0/me/drive/root:${ONEDRIVE_PATH}:/content`, content, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': etag
            }
        });
        res.json({ etag: response.data['@odata.etag'] });
    } catch (error) {
        if (error.response && error.response.status === 409) {
            res.status(409).json({ message: 'Conflict detected' });
        } else {
            console.error('API Error (PUT /api/board):', error.message);
            res.status(500).json({ error: error.message });
        }
    }
});

// 攔截所有路徑導向 index.html (SPA 支援)
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return; // 不要攔截 API
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Kanban Backend 啟動成功，運行在 port ${PORT}`);
});
