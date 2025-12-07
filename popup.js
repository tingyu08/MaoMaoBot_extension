const els = {
    targetUrl: document.getElementById('targetUrl'),
    account: document.getElementById('account'),
    password: document.getElementById('password'),
    ticketCount: document.getElementById('ticketCount'),
    priorityPrice: document.getElementById('priorityPrice'),
    priceString: document.getElementById('priceString'),
    grabAllBtn: document.getElementById('grabAllBtn'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    statusLabel: document.getElementById('statusLabel')
};

let grabAll = false;

chrome.storage.local.get(['ticketConfig'], (result) => {
    if (result.ticketConfig) {
        const config = result.ticketConfig;
        els.targetUrl.value = config.url || '';
        els.account.value = config.account || '';
        els.password.value = config.password || '';
        els.ticketCount.value = config.ticketCount || 1;
        els.priorityPrice.value = config.priorityPrice || '';
        els.priceString.value = config.targetPrices?.join(', ') || '';
        grabAll = config.grabAll || false;

        if (grabAll) {
            els.grabAllBtn.classList.add('active');
            els.grabAllBtn.textContent = '全區掃描模式 (已開啟)';
            els.priceString.disabled = true;
            els.priceString.style.opacity = '0.4';
            els.priceString.style.cursor = 'not-allowed';
            els.priceString.placeholder = '全區模式已開啟,不需設定';
        }
    }
});

function saveCurrentConfig() {
    const url = els.targetUrl.value.trim();
    const account = els.account.value.trim();
    const password = els.password.value.trim();
    const ticketCount = parseInt(els.ticketCount.value);
    const priorityPrice = parseInt(els.priorityPrice.value) || null;
    const priceString = els.priceString.value.trim();
    const targetPrices = priceString
        ? priceString.split(/[,\s]+/).map(p => parseInt(p.trim())).filter(p => !isNaN(p))
        : [];

    const config = {
        url,
        account,
        password,
        ticketCount,
        grabAll,
        targetPrices,
        priorityPrice,
        isRunning: false
    };

    chrome.storage.local.set({ ticketConfig: config });
}

els.targetUrl.addEventListener('input', saveCurrentConfig);
els.account.addEventListener('input', saveCurrentConfig);
els.password.addEventListener('input', saveCurrentConfig);
els.ticketCount.addEventListener('change', saveCurrentConfig);
els.priorityPrice.addEventListener('input', saveCurrentConfig);
els.priceString.addEventListener('input', saveCurrentConfig);

els.grabAllBtn.onclick = () => {
    grabAll = !grabAll;
    els.grabAllBtn.classList.toggle('active', grabAll);
    els.grabAllBtn.textContent = grabAll ? '全區掃描模式 (已開啟)' : '全區掃描模式 (點擊開啟)';

    els.priceString.disabled = grabAll;
    if (grabAll) {
        els.priceString.style.opacity = '0.4';
        els.priceString.style.cursor = 'not-allowed';
        els.priceString.placeholder = '全區模式已開啟,不需設定';
        els.priceString.value = '';
    } else {
        els.priceString.style.opacity = '1';
        els.priceString.style.cursor = 'text';
        els.priceString.placeholder = '例如: 2800, 3200';
    }

    saveCurrentConfig();
};

els.btnStart.onclick = () => {
    const url = els.targetUrl.value.trim();
    const account = els.account.value.trim();
    const password = els.password.value.trim();
    const ticketCount = parseInt(els.ticketCount.value);
    const priorityPrice = parseInt(els.priorityPrice.value) || null;
    const priceString = els.priceString.value.trim();

    if (!url || !url.startsWith('http')) {
        alert('❌ 請輸入有效的網址');
        return;
    }

    if (!grabAll && !priceString) {
        alert('❌ 請輸入目標票價,或開啟全區掃描模式');
        return;
    }

    const targetPrices = priceString
        ? priceString.split(/[,\s]+/).map(p => parseInt(p.trim())).filter(p => !isNaN(p))
        : [];

    const payload = {
        isRunning: true,
        url,
        account,
        password,
        ticketCount,
        grabAll,
        targetPrices,
        priorityPrice
    };

    chrome.storage.local.set({ ticketConfig: payload });

    els.statusLabel.textContent = '運行中';
    els.statusLabel.style.color = '#00ff00';

    chrome.contentSettings.images.set({
        primaryPattern: 'https://ticketplus.com.tw/*',
        setting: 'block'
    });

    chrome.tabs.create({
        url: url,
        active: true
    }, (tab) => {
        if (chrome.runtime.lastError) {
            alert('❌ 無法開啟分頁');
            els.statusLabel.textContent = '錯誤';
            els.statusLabel.style.color = '#ff0055';
            return;
        }

        setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
                action: "START",
                config: payload
            });
        }, 1000);
    });
};

els.btnStop.onclick = () => {
    chrome.storage.local.get(['ticketConfig'], (result) => {
        const config = result.ticketConfig || {};
        config.isRunning = false;
        chrome.storage.local.set({ ticketConfig: config });
    });

    chrome.contentSettings.images.set({
        primaryPattern: 'https://ticketplus.com.tw/*',
        setting: 'allow'
    });

    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: "STOP" }).catch(() => { });
        });
    });

    els.statusLabel.textContent = '已停止';
    els.statusLabel.color = '#ff0055';
};