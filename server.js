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

// 讀取檔案 (含 ETag 檢測)
app.get('/api/data', async (req, res) => {
    try {
        const token = await getAccessToken();
        const response = await axios.get(`https://graph.microsoftonline.com/v1.0${ONEDRIVE_FILE_PATH}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        res.json({
            etag: response.data['@odata.etag'],
            content: response.data // 假設這是一個下載連結或直接數據
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// 寫入檔案 (處理 409 Conflict)
app.post('/api/save', async (req, res) => {
    const { content, etag } = req.body;
    
    try {
        const token = await getAccessToken();
        const response = await axios.put(`https://graph.microsoftonline.com/v1.0${ONEDRIVE_FILE_PATH}:/content`, content, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': etag // ETag 衝突檢測關鍵
            }
        });
        res.send('儲存成功');
    } catch (error) {
        if (error.response && error.response.status === 409) {
            console.error('偵測到 409 Conflict: ETag 不匹配，有人在別端修改了檔案！');
            res.status(409).json({
                message: 'Conflict detected',
                hint: '請先讀取最新版本並合併後再儲存'
            });
        } else {
            res.status(500).send(error.message);
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kanban Backend 運行在 port ${PORT}`));
