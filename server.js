require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.')); // 確保可以服務前端網頁

const TOKEN_PATH = path.join(__dirname, 'token.json');
const ONEDRIVE_PATH = '/Kanban/data.json';

// 自動刷新或初始化 Token
async function getAccessToken() {
    let tokenData;
    
    // 優先讀取檔案
    if (fs.existsSync(TOKEN_PATH)) {
        tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    } 
    // 如果沒有檔案，嘗試從環境變數初始化 (Bootstrap)
    else if (process.env.REFRESH_TOKEN) {
        console.log('正在從環境變數初始化 Token...');
        tokenData = {
            refresh_token: process.env.REFRESH_TOKEN,
            expiry: 0 // 強制觸換下方的刷新邏輯
        };
    } else {
        throw new Error('找不到 token.json 且未設定 REFRESH_TOKEN 環境變數');
    }

    // 檢查是否過期
    if (Date.now() > (tokenData.expiry - 300000)) {
        console.log('Token 快要過期或尚未初始化，正在刷新...');
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
            console.log('Token 已成功更新並存入檔案。');
        } catch (error) {
            console.error('刷新 Token 失敗:', error.response ? error.response.data : error.message);
            throw error;
        }
    }
    return tokenData.access_token;
}

// 讀取看板
app.get('/api/board', async (req, res) => {
    try {
        const token = await getAccessToken();
        const response = await axios.get(`https://graph.microsoft.com/v1.0/me/drive/root:${ONEDRIVE_PATH}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const downloadRes = await axios.get(response.data['@microsoft.graph.downloadUrl']);
        res.json({
            etag: response.data['@odata.etag'],
            ...downloadRes.data
        });
    } catch (error) {
        console.error('Fetch error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 儲存看板
app.put('/api/board', async (req, res) => {
    try {
        const token = await getAccessToken();
        const response = await axios.put(`https://graph.microsoft.com/v1.0/me/drive/root:${ONEDRIVE_PATH}:/content`, req.body, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': req.headers['if-match']
            }
        });
        res.json({ etag: response.data['@odata.etag'] });
    } catch (error) {
        if (error.response && error.response.status === 409) {
            res.status(409).json({ message: 'Conflict detected' });
        } else {
            console.error('Save error:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Kanban Backend 運行在 port ${PORT}`);
    // 啟動時測試一次 Token
    getAccessToken().then(() => console.log('✅ Token 測試成功')).catch(e => console.error('❌ Token 測試失敗:', e.message));
});
