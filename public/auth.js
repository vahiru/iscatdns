async function renderTurnstile() {
    const widget = document.getElementById('turnstile-widget');
    if (widget) {
        try {
            const response = await fetch('/api/turnstile-sitekey');
            if (response.ok) {
                const { siteKey } = await response.json();
                turnstile.render('#turnstile-widget', {
                    sitekey: siteKey,
                    theme: 'light',
                });
            } else {
                console.error('Failed to fetch Turnstile site key:', response.statusText);
                widget.innerHTML = '<p class="text-danger">无法加载人机验证。请刷新页面。</p>';
            }
        } catch (error) {
            console.error('Error fetching Turnstile site key:', error);
            widget.innerHTML = '<p class="text-danger">加载人机验证时发生错误。请检查网络连接。</p>';
        }
    }
}

// Background image rotation logic
let backgroundImages = [];

async function fetchBackgroundImages() {
    try {
        const response = await fetch('/api/background-images');
        if (response.ok) {
            const data = await response.json();
            backgroundImages = data.images;
            if (backgroundImages.length > 0) {
                setRandomBackground();
            }
        }
    } catch (error) {
        console.error('Error fetching background images:', error);
    }
}

function setRandomBackground() {
    if (backgroundImages.length > 0) {
        const randomIndex = Math.floor(Math.random() * backgroundImages.length);
        const imageUrl = `/images/${backgroundImages[randomIndex]}`;
        document.body.style.backgroundImage = `url('${imageUrl}')`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
        document.body.style.backgroundAttachment = 'fixed';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchBackgroundImages();
    // Manually render Turnstile if the widget exists and turnstile object is available
    const turnstileWidget = document.getElementById('turnstile-widget');
    if (turnstileWidget && typeof turnstile !== 'undefined') {
        renderTurnstile();
    }
});