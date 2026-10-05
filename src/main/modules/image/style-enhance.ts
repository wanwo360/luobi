/**
 * 风格增强：把「画师/作品名」式中文风格术语翻译成模型能理解的视觉描述
 * 背景：用户/AI 常写「JOJO 风」「吉卜力风」——基础模型不认识画师名（SDXL/flux 只知道画面描述），
 * 直接生成= 风格全偏。此模块做术语 → 视觉语言映射（追加到 prompt 尾部）。
 * 纯函数，可被 Node 冒烟测试导入。
 */

interface StyleRule {
  trigger: RegExp
  description: string
}

const RULES: StyleRule[] = [
  {
    trigger: /jojo|荒木飞吕彦|荒木/i,
    description:
      "retro 1980s shounen manga style in the manner of JoJo's Bizarre Adventure covers by Hirohiko Araki: harsh black ink hatching and screentone shading, dramatic exaggerated muscular anatomy with blocky hard muscles, signature dynamic poses (lean back, low stance), strong perspective, bold asymmetrical composition, high contrast, vivid flat colors"
  },
  {
    trigger: /吉卜力|宫崎骏|ghibli/i,
    description:
      'studio ghibli-esque anime style: soft watercolor washes, pastel palette, painterly detailed pastoral backgrounds, whimsical characters, gentle lighting'
  },
  {
    trigger: /浮世绘|葛饰北斋|北斋/,
    description:
      'ukiyo-e woodblock print style: flat colors, elegant wavy linework, traditional japanese edo period imagery'
  },
  {
    trigger: /水墨|国画/,
    description:
      'traditional chinese ink wash painting: expressive brush strokes, abundant negative space, subtle ink gradients, rice paper texture'
  },
  {
    trigger: /赛博朋克/,
    description:
      'cyberpunk style: neon-lit rainy megacity, holographic signage, high-tech low-life atmosphere, cinematic haze'
  },
  {
    trigger: /蒸汽朋克/,
    description:
      'steampunk style: brass gears and victorian machinery, airship skyline, warm sepia lighting'
  },
  {
    trigger: /像素|8bit|八位|pixel/i,
    description:
      'retro pixel art style: 16-bit game aesthetic, limited color palette, chunky pixels'
  },
  {
    trigger: /水彩/,
    description: 'delicate watercolor painting style: translucent washes, soft bleeding edges, airy composition'
  },
  {
    trigger: /油画/,
    description: 'classical oil painting style: thick impasto brushwork, renaissance chiaroscuro lighting'
  },
  {
    trigger: /日式漫画|日漫|动漫风|二次元/,
    description:
      'modern japanese anime illustration: crisp cel-shading, precise lineart, vibrant saturated colors, clean composition'
  },
  {
    trigger: /美漫|美式漫画|american comic/i,
    description:
      'american comic book style: bold black inks, halftone dots, dramatic lighting, dynamic panel-frame composition'
  }
]

/**
 * 注入视觉风格描述：命中任一术语 → 在 prompt 尾部追加英文风格描述（不覆盖原文，
 * 让中文词与英文描述同时生效）；未命中 → 原样返回
 */
export function injectStyleEnhance(prompt: string): string {
  const text = String(prompt ?? '')
  for (const rule of RULES) {
    if (rule.trigger.test(text)) {
      // 追加时带分隔，避免与已有结尾粘连；已存在同类英文描述不再重复
      if (!text.toLowerCase().includes(rule.description.slice(0, 24).toLowerCase())) {
        return `${text}. Art style: ${rule.description}.`
      }
      return text
    }
  }
  return text
}
