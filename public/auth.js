// Function to render the Turnstile widget
async function renderTurnstile() {
    const widget = document.getElementById('turnstile-widget');
    if (widget && typeof turnstile !== 'undefined') {
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

// This function will be called by the Turnstile script once it's loaded
function onloadTurnstileCallback() {
    renderTurnstile();
}

// Dynamically load the Turnstile script
function loadTurnstileScript() {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

const handleFormSubmit = async (formId, url) => {
    const formContainer = document.getElementById(formId);
    if (!formContainer) return;

    const responseMessageDiv = document.getElementById('responseMessage');
    const displayAuthMessage = (message, isSuccess) => {
        if (!responseMessageDiv) return;
        responseMessageDiv.textContent = message;
        responseMessageDiv.className = `mt-3 text-center ${isSuccess ? 'text-success' : 'text-danger'}`;
    };

    displayAuthMessage('', true); // Clear previous messages

    // Manually collect data from inputs, selects within the container
    const inputs = formContainer.querySelectorAll('input, select');
    const data = {};
    inputs.forEach(input => {
        if (input.name) {
            data[input.name] = input.value;
        }
    });

    // Ensure Turnstile response is included
    const turnstileInput = formContainer.querySelector('[name="cf-turnstile-response"]');
    if (turnstileInput) {
        data['cf-turnstile-response'] = turnstileInput.value;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok) {
            if (result.redirect) {
                window.location.href = result.redirect;
            } else {
                displayAuthMessage(result.message || '操作成功！', true);
                // Don't reset the form, just the turnstile
                if (window.turnstile) turnstile.reset();
            }
        } else {
            displayAuthMessage(result.message || '操作失败，请重试。', false);
            if (window.turnstile) turnstile.reset();
        }
    } catch (error) {
        console.error(`Error submitting form ${formId}:`, error);
        displayAuthMessage('网络错误或服务器无响应。', false);
        if (window.turnstile) turnstile.reset();
    }
};

// This function will be called by the Turnstile script once it's loaded
window.renderTurnstileWidget = async function () {
    try {
        const response = await fetch('/api/turnstile-sitekey');
        const data = await response.json();
        const siteKey = data.siteKey;

        if (siteKey && document.getElementById('turnstile-widget')) {
            turnstile.render('#turnstile-widget', {
                sitekey: siteKey,
            });
        }
    } catch (error) {
        console.error('Error fetching Turnstile site key:', error);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // Dynamically load the Turnstile script with the onload callback
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=renderTurnstileWidget';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    // Background image logic
    try {
        const bgResponse = await fetch('/api/background-images');
        if (bgResponse.ok) {
            const bgData = await bgResponse.json();
            const backgroundImages = bgData.images;
            if (backgroundImages && backgroundImages.length > 0) {
                const randomIndex = Math.floor(Math.random() * backgroundImages.length);
                const imageUrl = `/images/${backgroundImages[randomIndex]}`;
                document.body.style.backgroundImage = `url('${imageUrl}')`;
            }
        }
    } catch (error) {
        console.error('Error fetching background images:', error);
    }

    // Display message from URL param (for email verification)
    const urlParams = new URLSearchParams(window.location.search);
    const message = urlParams.get('message');
    if (message) {
        const responseMessageDiv = document.getElementById('responseMessage');
        if (responseMessageDiv) {
            responseMessageDiv.textContent = decodeURIComponent(message);
            responseMessageDiv.className = 'mt-3 text-center text-success';
        }
    }
});