// ============================================================================
// TicketPlus 搶票機器人 - 重構版本
// 使用狀態機模式改善程式碼組織和可維護性
// ============================================================================

// ============================================================================
// 1. 狀態定義
// ============================================================================

const BotState = {
    IDLE: 'idle',                      // 閒置，等待啟動
    LOGIN: 'login',                    // 處理登入
    LOADING: 'loading',                // 等待頁面載入
    PRE_SALE: 'pre_sale',             // 等待開賣（顯示「開賣時間」）
    SEARCHING: 'searching',            // 搜尋符合條件的票區
    SELECTING: 'selecting',            // 選擇票數
    WAITING_RETURN: 'waiting_return',  // 等待返回選票頁面
    ERROR: 'error',                    // 處理錯誤對話框
    STOPPED: 'stopped'                 // 已停止
};

// ============================================================================
// 2. 配置與設定
// ============================================================================

// DOM 選擇器（集中管理）
const Selectors = {
    login: {
        phone: ["input[type='tel']", "input[name*='phone']", "#MazPhoneNumberInput-20_phone_number"],
        password: ["input[type='password']", "#input-26"],
        submitButton: "//button[contains(., '登入') or contains(., '登錄') or contains(., 'Login')]"
    },
    ticketArea: {
        areaButtons: "button.v-expansion-panel-header",
        excludeTabs: ".v-tabs",
        refreshButton: "//span[contains(text(), '更新票數')]"
    },
    quantity: {
        plusButton: "button i.mdi-plus",
        nextButton: "//button/span[contains(text(), '下一步')]"
    },
    dialog: {
        confirmButton: "//span[contains(text(), '確定')]"
    },
    statusText: {
        preSale: "開賣時間",           // 未開賣
        hotSelling: "熱賣中",          // 熱賣中
        soldOut: "已售完",             // 已售完
        remaining: /剩餘\s*(\d+)/      // 剩餘 X 張
    }
};

// 時間配置（毫秒）
const Timeouts = {
    LOGIN_RETRY: 200,          // 登入重試間隔
    ERROR_DIALOG: 100,         // 錯誤對話框處理後等待
    DOM_STABILITY: 50,         // DOM 穩定性檢查間隔
    BUTTON_CHECK: 100,         // 按鈕檢查間隔
    STATE_TRANSITION: 200,     // 狀態轉換等待
    REFRESH_INTERVAL: 200,     // 刷新按鈕檢查間隔
    REFRESH_WAIT: 200,         // 點擊刷新後等待
    RETURN_CHECK: 50,          // 返回頁面檢查間隔
    RETURN_DETECTED: 500,      // 檢測到返回後等待
    QUANTITY_POLL: 10,         // 票數選擇輪詢間隔
    QUANTITY_MAX_ATTEMPTS: 500 // 票數選擇最大嘗試次數
};

// 機器人配置
let config = {
    isRunning: false,
    ticketCount: 1,
    grabAll: false,
    targetPrices: [],
    priorityPrice: null,
    account: '',
    password: '',
    debug: false  // 除錯模式
};

// 狀態追蹤
let currentState = BotState.IDLE;
let lastLoginAttempt = 0;

// ============================================================================
// 3. 日誌系統
// ============================================================================

const Logger = {
    info: (msg) => {
        if (config.debug) console.log(`%c[機器人 資訊] ${msg}`, 'color: #00bfff; font-weight: bold');
    },
    warn: (msg) => {
        if (config.debug) console.warn(`%c[機器人 警告] ${msg}`, 'color: #ffa500; font-weight: bold');
    },
    error: (msg) => {
        console.error(`%c[機器人 錯誤] ${msg}`, 'color: #ff0055; font-weight: bold');
    },
    success: (msg) => {
        console.log(`%c[機器人 成功] ${msg}`, 'color: #00ff00; font-weight: bold');
    },
    state: (from, to) => {
        if (config.debug) console.log(`%c[狀態轉換] ${from} → ${to}`, 'color: #00ffff; font-weight: bold');
    }
};

// ============================================================================
// 4. 工具函數模組
// ============================================================================

const DOMUtils = {
    /**
     * 嘗試多個選擇器找到元素
     */
    findElement: (selectors) => {
        if (typeof selectors === 'string') {
            selectors = [selectors];
        }
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
        return null;
    },

    /**
     * 使用 XPath 查找元素
     */
    findByXPath: (xpath) => {
        return document.evaluate(xpath, document, null, 9, null).singleNodeValue;
    },

    /**
     * 檢查元素是否可見
     */
    isVisible: (element) => {
        return element && element.offsetParent !== null;
    },

    /**
     * 模擬輸入事件
     */
    simulateInput: (input, value) => {
        input.value = '';
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    },

    /**
     * 模擬 Enter 鍵按下
     */
    simulateEnter: (element) => {
        const enterEvents = [
            new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
            new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
            new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
        ];
        enterEvents.forEach(event => element.dispatchEvent(event));
    }
};

const PriceUtils = {
    /**
     * 格式化價格（加入千分位逗號）
     */
    format: (price) => {
        if (price === null || price === undefined || price === '') return '未設定';
        return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    },

    /**
     * 從文字中解析價格（取最大數字）
     */
    parseFromText: (text) => {
        const matches = text.match(/(\d{1,3}(?:,\d{3})*|\d+)/g);
        if (matches) {
            const numbers = matches.map(s => parseInt(s.replace(/,/g, '')));
            return Math.max(...numbers);
        }
        return null;
    }
};

const TicketUtils = {
    /**
     * 檢查票務可用性
     */
    checkAvailability: (buttonText, requiredCount) => {
        // 熱賣中
        if (buttonText.includes(Selectors.statusText.hotSelling)) {
            return { available: true, status: "熱賣中" };
        }

        // 已售完
        if (buttonText.includes(Selectors.statusText.soldOut) || buttonText.includes("剩餘 0")) {
            return { available: false, status: "已售完" };
        }

        // 剩餘票數檢查
        const remainingMatch = buttonText.match(Selectors.statusText.remaining);
        if (remainingMatch) {
            const remaining = parseInt(remainingMatch[1]);
            if (remaining < requiredCount) {
                return { available: false, status: `剩餘${remaining}張，不足${requiredCount}張` };
            }
            return { available: true, status: `剩餘${remaining}張` };
        }

        return { available: true, status: "狀態未知" };
    },

    /**
     * 獲取有效的票區按鈕
     */
    getValidAreaButtons: () => {
        return Array.from(document.querySelectorAll(Selectors.ticketArea.areaButtons))
            .filter(btn => {
                const text = btn.innerText.trim();
                // 過濾掉短文字且只包含"區"的分類標籤
                if (text.length < 10 && text.includes('區') && !text.includes('$') && !text.includes('NT')) {
                    return false;
                }
                // 過濾掉在 Tabs 內的按鈕
                if (btn.closest(Selectors.ticketArea.excludeTabs)) return false;
                return true;
            });
    }
};

// ============================================================================
// 5. 初始化與訊息監聽
// ============================================================================

// 從 storage 載入配置
chrome.storage.local.get(['ticketConfig'], (result) => {
    if (result.ticketConfig) {
        config = { ...config, ...result.ticketConfig };
        Logger.info('已載入配置');
        if (config.isRunning) {
            Logger.info('檢測到運行中狀態，啟動機器人');
            transitionTo(BotState.LOGIN);
        }
    }
});

// 監聽來自 popup 的訊息
chrome.runtime.onMessage.addListener((req, sender, sendRes) => {
    if (req.action === "START") {
        config = { ...config, ...req.config };
        Logger.success('收到啟動命令');
        transitionTo(BotState.LOGIN);
    } else if (req.action === "STOP") {
        config.isRunning = false;
        Logger.warn('收到停止命令');
        transitionTo(BotState.STOPPED);
    }
});

// ============================================================================
// 6. 狀態轉換核心
// ============================================================================

/**
 * 轉換到新狀態
 */
function transitionTo(newState) {
    if (currentState !== newState) {
        Logger.state(currentState, newState);
        currentState = newState;
    }

    // 執行狀態機
    setTimeout(() => runStateMachine(), 0);
}

/**
 * 狀態機主循環
 */
function runStateMachine() {
    if (!config.isRunning && currentState !== BotState.STOPPED && currentState !== BotState.IDLE) {
        Logger.warn('配置顯示未運行，停止機器人');
        transitionTo(BotState.STOPPED);
        return;
    }

    try {
        switch (currentState) {
            case BotState.IDLE:
                handleIdle();
                break;
            case BotState.LOGIN:
                handleLogin();
                break;
            case BotState.LOADING:
                handleLoading();
                break;
            case BotState.ERROR:
                handleError();
                break;
            case BotState.PRE_SALE:
                handlePreSale();
                break;
            case BotState.SEARCHING:
                handleSearching();
                break;
            case BotState.SELECTING:
                handleSelecting();
                break;
            case BotState.WAITING_RETURN:
                handleWaitingReturn();
                break;
            case BotState.STOPPED:
                handleStopped();
                break;
            default:
                Logger.error(`未知狀態: ${currentState}`);
                transitionTo(BotState.STOPPED);
        }
    } catch (error) {
        Logger.error(`狀態 ${currentState} 執行錯誤: ${error.message}`);
        // 發生錯誤時重試
        setTimeout(() => runStateMachine(), Timeouts.STATE_TRANSITION);
    }
}

// ============================================================================
// 7. 狀態處理函數
// ============================================================================

function handleIdle() {
    // 閒置狀態，等待啟動命令
    Logger.info('機器人處於閒置狀態');
}

function handleLogin() {
    // 檢查是否需要登入
    if (!config.account || !config.password) {
        Logger.info('無帳號密碼配置，跳過登入');
        transitionTo(BotState.LOADING);
        return;
    }

    const now = Date.now();
    if (now - lastLoginAttempt < 3000) {
        // 避免頻繁嘗試登入
        setTimeout(() => transitionTo(BotState.LOGIN), Timeouts.LOGIN_RETRY);
        return;
    }

    // 查找登入表單元素
    const phoneInput = DOMUtils.findElement(Selectors.login.phone);
    const passwordInput = DOMUtils.findElement(Selectors.login.password);

    if (!phoneInput || !passwordInput) {
        Logger.info('未找到登入表單，頁面可能已登入');
        transitionTo(BotState.LOADING);
        return;
    }

    // 檢查是否已填入
    const isAlreadyFilled = phoneInput.value === config.account && passwordInput.value === config.password;

    if (isAlreadyFilled) {
        const loginBtn = DOMUtils.findByXPath(Selectors.login.submitButton);
        if (!loginBtn) {
            Logger.info('已填入帳號密碼但未找到登入按鈕，可能已登入');
            transitionTo(BotState.LOADING);
            return;
        }
    }

    lastLoginAttempt = now;
    Logger.info('嘗試自動登入...');

    try {
        // 填入帳號密碼
        DOMUtils.simulateInput(phoneInput, config.account);
        DOMUtils.simulateInput(passwordInput, config.password);

        // 延遲後送出
        setTimeout(() => {
            try {
                DOMUtils.simulateEnter(passwordInput);
                Logger.success('已送出登入表單');
            } catch (err) {
                Logger.error(`送出登入失敗: ${err.message}`);
            }
        }, 100);

        // 等待後轉換到載入狀態
        setTimeout(() => transitionTo(BotState.LOADING), Timeouts.LOGIN_RETRY);
    } catch (err) {
        Logger.error(`登入處理錯誤: ${err.message}`);
        setTimeout(() => transitionTo(BotState.LOGIN), Timeouts.LOGIN_RETRY);
    }
}

function handleLoading() {
    // 先檢查是否有錯誤對話框
    const confirmBtn = DOMUtils.findByXPath(Selectors.dialog.confirmButton);
    if (confirmBtn) {
        Logger.warn('檢測到錯誤對話框');
        transitionTo(BotState.ERROR);
        return;
    }

    // 獲取票區按鈕
    const areaButtons = TicketUtils.getValidAreaButtons();

    if (areaButtons.length === 0) {
        Logger.info('頁面載入中，未找到票區按鈕...');
        // 等待一段時間後重新檢查
        setTimeout(() => {
            const updatedButtons = TicketUtils.getValidAreaButtons();
            if (updatedButtons.length === 0) {
                Logger.warn('頁面仍無票區，可能需要刷新');
                // 嘗試點擊刷新
                waitAndClickRefresh(() => {
                    setTimeout(() => transitionTo(BotState.LOADING), Timeouts.REFRESH_WAIT);
                });
            } else {
                Logger.info('票區已載入，繼續檢查');
                transitionTo(BotState.LOADING);
            }
        }, Timeouts.BUTTON_CHECK);
        return;
    }

    // 等待 DOM 穩定
    setTimeout(() => {
        const stableButtons = TicketUtils.getValidAreaButtons();

        if (stableButtons.length !== areaButtons.length) {
            Logger.info('DOM 還在變化，等待穩定...');
            transitionTo(BotState.LOADING);
            return;
        }

        // 檢查第一個區域是否顯示「開賣時間」（未開賣）
        if (stableButtons.length > 0) {
            const firstAreaText = stableButtons[0].innerText;
            if (firstAreaText.includes(Selectors.statusText.preSale)) {
                Logger.warn('檢測到「開賣時間」，票尚未開賣');
                transitionTo(BotState.PRE_SALE);
                return;
            }
        }

        // 頁面已載入且穩定，開始搜尋
        Logger.success('頁面載入完成，開始搜尋票區');
        transitionTo(BotState.SEARCHING);
    }, Timeouts.DOM_STABILITY);
}

function handleError() {
    const confirmBtn = DOMUtils.findByXPath(Selectors.dialog.confirmButton);

    if (confirmBtn) {
        Logger.info('點擊錯誤對話框的確定按鈕');
        confirmBtn.click();
        setTimeout(() => transitionTo(BotState.LOADING), Timeouts.ERROR_DIALOG);
    } else {
        Logger.warn('錯誤對話框已消失');
        transitionTo(BotState.LOADING);
    }
}

function handlePreSale() {
    Logger.info('等待開賣，準備刷新...');
    waitAndClickRefresh(() => {
        setTimeout(() => transitionTo(BotState.LOADING), Timeouts.REFRESH_WAIT);
    });
}

function handleSearching() {
    const areaButtons = TicketUtils.getValidAreaButtons();

    if (areaButtons.length === 0) {
        Logger.warn('搜尋中未找到票區，刷新頁面');
        waitAndClickRefresh(() => {
            setTimeout(() => transitionTo(BotState.LOADING), Timeouts.REFRESH_WAIT);
        });
        return;
    }

    let priorityAreas = [];
    let otherAreas = [];

    for (let i = 0; i < areaButtons.length; i++) {
        const btn = areaButtons[i];
        const text = btn.innerText;

        // 檢查票務可用性
        const ticketCheck = TicketUtils.checkAvailability(text, config.ticketCount);
        if (!ticketCheck.available) continue;

        let matchedPrice = null;

        if (config.grabAll) {
            // 全區模式
            const extractedPrice = PriceUtils.parseFromText(text);
            matchedPrice = extractedPrice !== null ? extractedPrice : 0;
        } else {
            // 指定票價模式
            for (const targetPrice of config.targetPrices) {
                const formattedPrice = PriceUtils.format(targetPrice);
                if (text.includes(formattedPrice) || text.includes(targetPrice.toString())) {
                    matchedPrice = parseInt(targetPrice);
                    break;
                }
            }
        }

        if (matchedPrice !== null) {
            const areaInfo = {
                button: btn,
                price: matchedPrice,
                status: ticketCheck.status,
                index: i
            };

            // 優先票價檢查
            if (config.priorityPrice && matchedPrice === parseInt(config.priorityPrice)) {
                priorityAreas.push(areaInfo);
            } else {
                otherAreas.push(areaInfo);
            }
        }
    }

    const targetAreas = priorityAreas.concat(otherAreas);

    if (targetAreas.length === 0) {
        Logger.warn('未找到符合條件的票區，刷新頁面');
        waitAndClickRefresh(() => {
            setTimeout(() => transitionTo(BotState.LOADING), Timeouts.REFRESH_WAIT);
        });
        return;
    }

    // 找到目標票區，點擊
    const target = targetAreas[0];

    // 如果狀態未知，刷新頁面重新檢查
    if (target.status === "狀態未知") {
        Logger.warn('目標票區狀態未知，刷新頁面重新檢查');
        waitAndClickRefresh(() => {
            setTimeout(() => transitionTo(BotState.LOADING), Timeouts.REFRESH_WAIT);
        });
        return;
    }

    Logger.success(`找到目標票區: $${PriceUtils.format(target.price)} (${target.status})`);
    target.button.click();

    // 轉換到選擇票數狀態
    transitionTo(BotState.SELECTING);
}

function handleSelecting() {
    let clickCount = 0;
    const maxAttempts = Timeouts.QUANTITY_MAX_ATTEMPTS;

    const checkQuantityUI = setInterval(() => {
        if (!config.isRunning || clickCount++ > maxAttempts) {
            clearInterval(checkQuantityUI);
            if (clickCount > maxAttempts) {
                Logger.error('票數選擇超時，重新搜尋');
                transitionTo(BotState.SEARCHING);
            }
            return;
        }

        // 檢查加號按鈕
        const plusBtns = document.querySelectorAll(Selectors.quantity.plusButton);
        const nextBtn = DOMUtils.findByXPath(Selectors.quantity.nextButton);

        if (plusBtns.length > 0) {
            const plusBtn = plusBtns[0].closest('button');
            Logger.info(`選擇票數: ${config.ticketCount} 張`);
            for (let i = 0; i < config.ticketCount; i++) {
                plusBtn.click();
            }
        }

        if (nextBtn) {
            Logger.success('票數已選擇，點擊下一步');
            nextBtn.click();
            clearInterval(checkQuantityUI);
            transitionTo(BotState.WAITING_RETURN);
        }
    }, Timeouts.QUANTITY_POLL);
}

function handleWaitingReturn() {
    Logger.success('✅ 搶票流程完成！');
    Logger.info('提示: 機器人將監控返回選票頁面，如需再次搶票請手動返回');

    // 監控是否返回選票頁面
    const checkReturnInterval = setInterval(() => {
        if (!config.isRunning) {
            clearInterval(checkReturnInterval);
            return;
        }

        const updateButton = DOMUtils.findByXPath(Selectors.ticketArea.refreshButton);
        if (updateButton) {
            clearInterval(checkReturnInterval);
            Logger.success('檢測到返回選票頁面，重新開始搶票');
            setTimeout(() => transitionTo(BotState.LOADING), Timeouts.RETURN_DETECTED);
        }
    }, Timeouts.RETURN_CHECK);
}

function handleStopped() {
    Logger.info('機器人已停止');
    currentState = BotState.IDLE;
}

// ============================================================================
// 8. 輔助函數
// ============================================================================

/**
 * 等待刷新按鈕完全載入後再點擊
 */
function waitAndClickRefresh(callback) {
    let attempts = 0;
    const maxAttempts = 20;
    const checkInterval = setInterval(() => {
        if (!config.isRunning || attempts++ > maxAttempts) {
            clearInterval(checkInterval);
            if (callback && attempts <= maxAttempts) callback();
            return;
        }
        const refreshBtn = DOMUtils.findByXPath(Selectors.ticketArea.refreshButton);
        if (refreshBtn && DOMUtils.isVisible(refreshBtn)) {
            clearInterval(checkInterval);
            Logger.info('點擊刷新按鈕');
            refreshBtn.click();
            if (callback) callback();
        }
    }, Timeouts.REFRESH_INTERVAL);
}