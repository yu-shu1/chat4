document.addEventListener('DOMContentLoaded', async () => {
    const loaderBar = document.getElementById('loader-tech-bar');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle-scramble');
    const welcomeScreen = document.getElementById('welcome-animation');
    const disclaimerModal = document.getElementById('disclaimer-modal');
    const acceptDisclaimerBtn = document.getElementById('accept-disclaimer');

    const updateLoader = (text, width) => {
        if (welcomeSubtitle) welcomeSubtitle.textContent = text;
        if (loaderBar) loaderBar.style.width = width;
    };

    const hideWelcomeScreen = () => {
        if (!welcomeScreen) return;
        welcomeScreen.classList.add('hidden');
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
        }, 800);
    };

    const safeAwait = async (promise, fallback = null) => {
        try {
            return await promise;
        } catch (error) {
            console.error('操作失败:', error);
            return fallback;
        }
    };

    try {
        try { setupEventListeners?.(); } catch(e) { console.error('setupEventListeners:', e); }

        if (typeof localforage === 'undefined') {
            console.warn('LocalForage 未加载，将使用 localStorage 降级方案');
        }

        try {
            const emergencyBackupRaw = localStorage.getItem('BACKUP_V1_critical');
            if (emergencyBackupRaw) {
                const emergencyBackup = JSON.parse(emergencyBackupRaw);
                if (emergencyBackup && Array.isArray(emergencyBackup.messages) && emergencyBackup.messages.length > 0) {
                    console.warn('[boot] 检测到紧急备份，可用于异常恢复');
                }
            }
        } catch (e) {
            console.warn('[boot] 紧急备份检查失败:', e);
        }

        updateLoader('正在建立安全连接...', '10%');
        await safeAwait(initializeSession());

        updateLoader('正在读取记忆存档...', '40%');
        await safeAwait(loadData());

        updateLoader('正在渲染我们的世界...', '70%');
        
        await Promise.allSettled([
            safeAwait(initializeRandomUI?.()),
            safeAwait(initMusicPlayer?.())
        ]);

        setInterval(checkStatusChange, 60000);

        updateLoader('连接成功，欢迎回来。', '100%');
        // 修改：欢迎动画结束后，先隐藏欢迎屏幕，再显示桌面
        setTimeout(() => {
            hideWelcomeScreen();
            setTimeout(() => {
                afterWelcome();  // 显示桌面并绑定图标
            }, 850);
        }, 3500);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                try {
                    if (typeof saveTimeout !== 'undefined') clearTimeout(saveTimeout);
                } catch (e) {}
                try { _backupCriticalData(); } catch (e) { console.warn('[visibilitychange] 紧急备份失败:', e); }
                try {
                    const p = saveData();
                    if (p && typeof p.catch === 'function') {
                        p.catch(e => console.error('[visibilitychange] 保存失败:', e));
                    }
                } catch (e) {
                    console.error('[visibilitychange] 保存失败:', e);
                }
            } else if (document.visibilityState === 'visible') {
                try {
                    const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
                    if (backup && Array.isArray(backup.messages) && backup.messages.length > 0 && Array.isArray(messages) && backup.messages.length > messages.length) {
                        console.warn('[visibilitychange] 检测到备份消息比当前更多，自动尝试恢复');
                        try {
                            messages = backup.messages.map(m => ({
                                ...m,
                                timestamp: new Date(m.timestamp)
                            }));
                            if (backup.settings) Object.assign(settings, backup.settings);
                            if (typeof updateUI === 'function') updateUI();
                            if (typeof throttledSaveData === 'function') throttledSaveData();
                            showNotification('已自动恢复本地临时备份内容', 'warning', 3500);
                        } catch (restoreErr) {
                            console.warn('[visibilitychange] 自动恢复失败，保留当前页面内容:', restoreErr);
                        }
                    }
                } catch (e) {
                    console.warn('[visibilitychange] 恢复备份失败:', e);
                }
            }
        });

        window.addEventListener('pagehide', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        window.addEventListener('beforeunload', () => {
            try { _backupCriticalData(); } catch (e) {}
        });

        setInterval(() => {
            saveData().catch(e => console.warn('[autoBackup] 定时保存失败:', e));
        }, 3 * 60 * 1000);

        (() => {
            const REMIND_KEY = 'exportReminderLastShown';
            const last = parseInt(localStorage.getItem(REMIND_KEY) || '0', 10);
            const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
            if (daysSince >= 7) {
                setTimeout(() => {
                    showNotification('建议定期导出备份，防止数据意外丢失', 'info', 7000);
                    localStorage.setItem(REMIND_KEY, String(Date.now()));
                }, 8000);
            }
        })();

        setTimeout(async () => {
            if ('Notification' in window && Notification.permission === 'default') {
                try {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        showNotification('已开启系统通知，收到消息时会提醒你', 'success', 3000);
                    }
                } catch(e) {
                    console.warn('通知权限请求失败:', e);
                }
            }
        }, 3000);

    } catch (err) {
        console.error('严重初始化错误:', err);
        try {
            const backup = typeof _tryRecoverFromBackup === 'function' ? _tryRecoverFromBackup() : null;
            if (backup && Array.isArray(backup.messages) && backup.messages.length > 0) {
                messages = backup.messages.map(m => ({
                    ...m,
                    timestamp: new Date(m.timestamp)
                }));
                if (backup.settings) Object.assign(settings, backup.settings);
                if (typeof updateUI === 'function') updateUI();
                showNotification('初始化异常，已使用本地紧急备份恢复', 'warning', 5000);
            }
        } catch (recoverErr) {
            console.warn('[boot] 初始化失败后的恢复也失败:', recoverErr);
        }
        updateLoader('加载遇到问题，已强制进入...', '100%');
        setTimeout(() => {
            hideWelcomeScreen();
            setTimeout(() => afterWelcome(), 850);
        }, 3500);
    }
    
    setTimeout(() => {
        if (typeof syncAllToggles === 'function') syncAllToggles();
    }, 1500);    
    
    setTimeout(() => {
        if (typeof syncAllToggles === 'function') syncAllToggles();
    }, 2500);    
});

const stickerInput = document.getElementById('sticker-file-input');
if (stickerInput) {
    stickerInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
        if (oversized.length > 0) {
            showNotification(oversized.length + ' 张图片超过 2MB 限制，已跳过', 'warning');
        }

        const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
        if (!validFiles.length) return;

        showNotification('正在批量处理 ' + validFiles.length + ' 张图片...', 'info');

        let successCount = 0;
        let failCount = 0;

        for (const file of validFiles) {
            try {
                const base64 = await optimizeImage(file, 300, 0.8);
                stickerLibrary.push(base64);
                successCount++;
            } catch (err) {
                console.error(err);
                failCount++;
            }
        }

        throttledSaveData();
        renderReplyLibrary();

        if (failCount > 0) {
            showNotification('上传完成：' + successCount + ' 张成功，' + failCount + ' 张失败', 'warning');
        } else {
            showNotification('上传成功，共 ' + successCount + ' 张', 'success');
        }

        e.target.value = '';
    });
}

const myStickerQuickUpload = document.getElementById('my-sticker-quick-upload');
if (myStickerQuickUpload) {
    myStickerQuickUpload.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const oversized = files.filter(f => f.size > 2 * 1024 * 1024);
        if (oversized.length > 0) showNotification(oversized.length + ' 张图片超过 2MB，已跳过', 'warning');
        const validFiles = files.filter(f => f.size <= 2 * 1024 * 1024);
        if (!validFiles.length) return;
        showNotification('正在处理 ' + validFiles.length + ' 张...', 'info');
        let ok = 0, fail = 0;
        for (const file of validFiles) {
            try {
                const base64 = await optimizeImage(file, 300, 0.8);
                myStickerLibrary.push(base64);
                ok++;
            } catch(err) { fail++; }
        }
        throttledSaveData();
        if (typeof renderComboContent === 'function') renderComboContent('my-sticker');
        showNotification(fail > 0 ? `上传完成：${ok} 成功 ${fail} 失败` : `✓ 已添加 ${ok} 张到我的表情库`, fail > 0 ? 'warning' : 'success');
        e.target.value = '';
    });
}

window.addEventListener('load', function() {
    setTimeout(function() {
        try {
            // 清除“今日已弹”记录，确保每次刷新都弹出（必须）
            localStorage.removeItem('dailyGreetingShown');

            // 检查并记录对方心情（原有功能，不影响弹出）
            try { if (typeof checkPartnerDailyMood === 'function') checkPartnerDailyMood(); } catch(e2) { console.warn('checkPartnerDailyMood error:', e2); }
            
            // 构建公告内容（基于当天数据）
            if (typeof _buildDailyGreeting === 'function') _buildDailyGreeting();
            
            // 强制弹出公告（移除隐藏类、确保显示）
            var modal = document.getElementById('daily-greeting-modal');
            if (modal) {
                modal.classList.remove('hidden');
                // 如果模态框因其他样式导致不可见，强制设为可见
                modal.style.display = 'flex';
                modal.style.opacity = '1';
            }
        } catch(e) { 
            console.warn('Daily greeting timing error:', e); 
        }
    }, 1000);
});

// 显示桌面，隐藏聊天
function showHomeScreen() {
    document.getElementById('home-screen').classList.add('active');
    document.getElementById('chat-view').classList.remove('active');
}

// 显示聊天，隐藏桌面
function showChatScreen() {
    document.getElementById('home-screen').classList.remove('active');
    document.getElementById('chat-view').classList.add('active');
    // 刷新消息列表
    if (typeof renderMessages === 'function') renderMessages();
}

// 绑定桌面图标点击事件
function bindHomeIcons() {
    const icons = document.querySelectorAll('.app-icon');
    icons.forEach(icon => {
        icon.addEventListener('click', (e) => {
            const app = icon.dataset.app;
            switch(app) {
                case 'chat':
                    showChatScreen();
                    break;
                case 'envelope':
                    if (typeof renderEnvelopeBoard === 'function') renderEnvelopeBoard();
                    else if (typeof showModal === 'function') showModal(document.getElementById('envelope-board-modal'));
                    break;
                case 'anniversary':
                    if (typeof renderAnniversariesList === 'function') renderAnniversariesList();
                    showModal(document.getElementById('anniversary-modal'));
                    break;
                case 'mood':
                    showModal(document.getElementById('mood-modal'));
                    if (typeof renderMoodCalendar === 'function') renderMoodCalendar();
                    break;
                case 'music':
                    if (typeof toggleMusicPlayer === 'function') toggleMusicPlayer();
                    else document.getElementById('player').classList.toggle('visible');
                    break;
                case 'fortune':
                    generateFortune();
                    showModal(document.getElementById('fortune-lenormand-modal'));
                    break;
                case 'reply':
                    showModal(document.getElementById('custom-replies-modal'));
                    if (typeof renderReplyLibrary === 'function') renderReplyLibrary();
                    break;
                case 'data':
                    showModal(document.getElementById('data-modal'));
                    break;
                default: break;
            }
        });
    });
}

// 绑定聊天界面顶部“主页”按钮，点击返回桌面
function bindHomeBackBtn() {
    const homeBackBtn = document.getElementById('home-back-btn');
    if (homeBackBtn) {
        homeBackBtn.addEventListener('click', () => {
            showHomeScreen();
        });
    }
}

// 在欢迎动画结束时调用，初始化桌面并绑定所有交互
function afterWelcome() {
    showHomeScreen();
    bindHomeIcons();
    bindHomeBackBtn();
    updateUI();
}
