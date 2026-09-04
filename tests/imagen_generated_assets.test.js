const test = require('node:test');
const assert = require('node:assert');
const { GeminiResponseParserClass } = require('../src/core/api/geminiParser.js');
const ChatFormatter = require('../src/core/engine/chatFormatter.js');

test('geminiParser - extracts Imagen generated image node (Pattern 2)', () => {
    const imagenNode = [
        null,
        1,
        "watermarked_img_16704480932994645752.jpg",
        "https://lh3.googleusercontent.com/gg/ACRwjavPniU5LRENaIm-6aleFKYDMfW02Me91e7oUbbDuHypWF8TDRUFAz5zE2Y7M1upuCMvqxWTVyWcLXR8BwcVS1nerGoqpPu_QVQx8_PKx7s90wbEEzU0K6jFPcN3gXW6a9r0aQRbMqAMsf5E2BbXFF-3_mNpi2NYTk2rLDYXVLuG2f-nf8sSUFMX2PNySGUpMhnTrNU2Iil4KOYL8TDvZZOI5wa85y-OZPgrXaGw55oLUzGQJJOtD3BZLbQRLm3GnxbTSA-CyHJYaTRmpJ7cK8uHN0-FKXzDVsR5hsn8aiVJ3Es0XnINPusg9R-RD24UC9C8sj2zuiqELa38-2ydh9s",
        null,
        "$AXzLiRwXeOJl0Bt2a6m8QL9S1mQCi42r7EROQ1BwqIcZuJ7TcSejJZs1+VG6z1sCdz04lS3zi0VG15MJu/gH9vxDCduu2HXts8vz4GGsQACLzMBNRkW16m2RT7Ouec1LmWXZjummxEQf6ZbbqLwtbtXEGcQJRDhYy2YazFTtCGLdjg1Pi+BDKbu4lcp9+ByL1UwZkfImLoEqSIsdcoiiXVpbCtPyTb3FfJ54JfznUZyNlnJPRnF7kESwJSf9uIscq385RSrXqTJ56Bf9SNFADjThOQ==",
        null,
        null,
        null,
        [1788550788, 840331369],
        null,
        "image/jpeg",
        null,
        null,
        null,
        [1408, 768, 924784]
    ];

    const candidateBlock = [
        "rc_3244407ff0cfc512",
        ["\n\nhttp://googleusercontent.com/image_generation_content/2_557\n\n"],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [
            null, null, null, null, null, null, null,
            [
                [
                    [
                        [null, null, null, imagenNode],
                        ["http://googleusercontent.com/image_generation_content/2_557"]
                    ]
                ]
            ]
        ]
    ];

    const images = GeminiResponseParserClass.extractImages(candidateBlock);
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].fileName, "watermarked_img_16704480932994645752.jpg");
    assert.strictEqual(images[0].mimeType, "image/jpeg");
    assert.strictEqual(images[0].width, 1408);
    assert.strictEqual(images[0].height, 768);
    assert.strictEqual(images[0].size, 924784);
    assert.ok(images[0].sourceUrl.startsWith("https://lh3.googleusercontent.com/gg/"));
});

test('geminiParser - extracts Python plot generated asset (Pattern 2)', () => {
    const plotNode = [
        null,
        1,
        "ekf_fusion_result.png",
        "https://lh3.googleusercontent.com/gg/ACRwjaub7uiGm3T7VzMR-_B160VqDtHahpFPSKkGxl83nyPiTl-gQAGRonXla9yjtkouerHkESRUW4PIsBzk-oRy4_prRC8-BU2I1iR0TB8p6ZZQJyF6bacgakdj3wTxqKqDI9tU6xGmHIC5nGU-OlDGXaG-q1ocDIvbLpwEGMy5zwJys8ynKyYhfZ2F99G8iBEwgZaFpp8Wa15Rp92w0yLMXxYVK5d6kTc_4IM-pKyGbYkpJXopNxDEyu5MT5OjsVJCwTgwuC9nKdQAkPr3sV-IVLgW2QmHaLGtOEo1ThTv8qRnaVMyuY2K61ZQEuhdOes5Waz5xEjb8RPb-70ytUu6Inpg",
        null,
        "$AXzLiRxGsTj2Vi/eWubYyP3wsoOqlIpX7K7b29iA9U+LHs7m3Q+0YN+fSvvLNMqwSUGRf4V7BlyRLZfpU8QVKbDdYyzDeMWMyrEbU0G6/v/2FgkxqzDhxcbSzutREhVQfLFWW2DNwuGmJ1qHmyng7ikzbzl9UYG1JAi15eNBTjZCJqYIId++YuNoLqi0UUKymeaVgwYNIiVrgwxTJREFX/LrCTVk0jTATeTqWeXM6yl1",
        null,
        null,
        null,
        null,
        null,
        "image/png",
        null,
        null,
        null,
        [900, 700, 93650]
    ];

    const images = GeminiResponseParserClass.extractImages(plotNode);
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].fileName, "ekf_fusion_result.png");
    assert.strictEqual(images[0].mimeType, "image/png");
    assert.strictEqual(images[0].width, 900);
    assert.strictEqual(images[0].height, 700);
    assert.strictEqual(images[0].size, 93650);
});

test('chatFormatter - formats generated image as markdown and cleans placeholder URLs', () => {
    const mockChat = {
        id: '61a5e19c42b800f3',
        title: '深渊AUV材料与通信挑战',
        url: 'https://gemini.google.com/app/61a5e19c42b800f3',
        timestamp: 1788550788000,
        messages: [
            {
                role: 'user',
                content: '请帮我生成一张图片：深海潜水器'
            },
            {
                role: 'model',
                content: 'http://googleusercontent.com/image_generation_content/2_557',
                images: [
                    {
                        sourceUrl: 'https://lh3.googleusercontent.com/gg/ACRwjavPniU5LRENaIm-6aleFKYDMfW02Me91e7oUbb',
                        resolvedUrl: 'https://lh3.googleusercontent.com/gg/ACRwjavPniU5LRENaIm-6aleFKYDMfW02Me91e7oUbb=s0',
                        localName: 'assets/b800f3_watermarked_img_16704480932994645752.jpg',
                        fileName: 'watermarked_img_16704480932994645752.jpg',
                        width: 1408,
                        height: 768,
                        type: 'image'
                    }
                ]
            }
        ]
    };

    const res = ChatFormatter.toMarkdown(mockChat);
    // 必须包含 Markdown 图片引用 ![]
    assert.ok(res.includes('!['));
    assert.ok(res.includes('assets/b800f3_watermarked_img_16704480932994645752.jpg'));
    // 不应泄露裸露的 image_generation_content 占位行
    assert.ok(!res.includes('http://googleusercontent.com/image_generation_content/2_557'));
});
