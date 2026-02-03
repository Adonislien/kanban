require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());

const ONEDRIVE_FILE_PATH = '/drive/root:/kanban/data.json';
const TOKEN_PATH = './token.json';

// 自動刷新 Token 的邏輯
async function getAccessToken() {
    let tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    
    // 檢查是否過期 (此處為簡化邏輯)
    if (Date.now() > tokenData.expiry) {
        console.log('Token 過期，正在自動刷新...');
        const response = await axios.post('https://login.microsoftonline.com/common/oauth2/v2.0/token', new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            refresh_token: tokenData.refresh_token,
            grant_type: 'refresh_token'
        }));
        
        tokenData = {
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expiry: Date.now() + (response.data.expires_in * 1000)
        };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData));
    }
    return tokenData.access_token;
}

// 讀取看板 (GET)
app.get('/api/board', async (req, res) => {
    try {
        const token = await getAccessToken();
        const response = await axios.get(`https://graph.microsoft.com/v1.0/me/drive/root:/Kanban/data.json`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        // 下載檔案內容
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

// 儲存看板 (PUT)
app.put('/api/board', async (req, res) => {
    const content = req.body;
    const etag = req.headers['if-match'];
    
    try {
        const token = await getAccessToken();
        const response = await axios.put(`https://graph.microsoft.com/v1.0/me/drive/root:/Kanban/data.json:/content`, content, {
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
            console.error('Save error:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kanban Backend 運行在 port ${PORT}`));
