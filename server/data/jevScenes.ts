/**
 * 场景判断表：每个场景的「是非题 + 语气题 + 摩擦题 + 可选立场」。
 *
 * 移植自开源项目 **jev-chat/jev-chat-jarvis**（MIT，Copyright (c) 2026
 * Finderchangchang and the jev-chat contributors）：上游在
 * `global/core/src/main/kotlin/.../scene/*.kt` 里按 `behaviour × 关系` 的矩阵
 * 定义这些判断，本文件是**压缩后的复刻**（46 条行为，上游共 78 条），
 * 逐格钉住的矩阵没有被搬过来。
 *
 * ⚠️ 署名要求（上游 NOTICE）：保留其 LICENSE 与 NOTICE、在使用处的「关于」或文档里
 * 注明出处，且**不得**用「Jev 聊天助手」「jev-chat」的名称或域名暗示原作者为本站背书。
 *
 * 字段：
 *   q      中文问法，界面显示用
 *   qEn    英文问法，**问 Jev 时优先用它**（上游实测：instructions/criteria 用英文、
 *          state 用中文时 confidence 明显更高 0.99 vs 0.84 且打分整体上移）
 *   nextStep  检测到该行为后下一步该做什么（上游由矩阵给出）
 *
 * 谁在用：`server/utils/jevRound.ts` 消费它；网页 `app/pages/jev/index.vue` 只读
 * 里面的 label / relationships 做下拉框。要改判断口径，先看 jevRound.ts 顶部的说明。
 */

import type { SceneTable } from '../utils/jevRound'

export const JEV_SCENES_META = {
  source: "jev-chat/jev-chat-jarvis @ main",
  license: "MIT",
  url: 'https://github.com/jev-chat/jev-chat-jarvis',
  note: 'MIT：保留 LICENSE/NOTICE、注明出处，且不得用其名称或域名暗示背书。',
} as const

export const JEV_SCENES: SceneTable = {
  "work": {
    "label": "工作",
    "relationships": [
      "上级",
      "同事",
      "下属",
      "客户"
    ],
    "behaviours": [
      {
        "id": "w_deliverable",
        "q": "对方在要求我交出或完成一件本来就是我份内的工作吗？",
        "qEn": "Is the other person asking me to hand over or finish a piece of work that is already mine to do?",
        "nextStep": "先给时间，再谈范围，不要只回「在做」"
      },
      {
        "id": "w_progress",
        "q": "对方在问某件事的进度或什么时候能好吗？",
        "qEn": "Is the other person asking how far along something is, or when it will be ready?",
        "nextStep": "给一个具体时间点，不要回「快了」"
      },
      {
        "id": "w_decision",
        "q": "对方在要我拍板、批准或确认一件事吗？",
        "qEn": "Is the other person asking me to approve, choose, or confirm something?",
        "nextStep": "明确说同意或不同意，别拖着不回"
      },
      {
        "id": "w_new_work",
        "q": "对方在把一件原本不属于我的活或人情推给我吗？",
        "qEn": "Is the other person handing me a task or asking a favour that was not mine to begin with?",
        "nextStep": "先问是谁派的、要不要调优先级，再决定接不接"
      },
      {
        "id": "w_info",
        "q": "对方在问一个需要我回答的事实性问题吗？",
        "qEn": "Is the other person asking me a factual question that I am expected to answer?",
        "nextStep": "直接给答案，不知道就说去查、什么时候回"
      },
      {
        "id": "w_problem",
        "q": "对方在指出我的工作或做法有问题、有错或迟了吗？",
        "qEn": "Is the other person pointing out that my work or my conduct is wrong, late, or not good enough?",
        "nextStep": "先确认收到问题，再给处理时间；对客户先确认再认错"
      },
      {
        "id": "w_time",
        "q": "对方在约会议、通话或碰面的时间吗？",
        "qEn": "Is the other person proposing or asking for a time for a meeting, a call, or a catch-up?",
        "nextStep": "能去就确认，不能就立刻给替代时间"
      },
      {
        "id": "w_deadline",
        "q": "对方在这条消息里给出了一个明确的截止时间吗？",
        "qEn": "Does this message state an explicit deadline, or a time by which something is expected of me?",
        "nextStep": "把这个时间复述一遍，不要改口径"
      },
      {
        "id": "w_escalation",
        "q": "对方提到要把这件事上报给上级、HR 或客户吗？",
        "qEn": "Does the other person mention raising this with a manager, HR, or the client?",
        "nextStep": "按流程回应，既不当威胁也不赌气"
      },
      {
        "id": "w_chasing",
        "q": "对方在重复催一件之前已经提过的事吗？",
        "qEn": "Is the other person repeating a request they already made earlier in the conversation?",
        "nextStep": "这是压力信号，先答时间再答内容"
      }
    ],
    "tone": [
      {
        "id": "w_tone_impatience",
        "q": "对方的措辞是「如前所述」「再跟进一下」这类表面客气、实际已经不耐烦的说法吗？",
        "qEn": "Does the other person use wording such as \"per my last email\" or \"just following up again\" that is formally polite but often signals impatience?"
      },
      {
        "id": "w_tone_cold",
        "q": "对方这条消息的语气是冷淡、疏远或纯公事公办的吗？",
        "qEn": "Is the tone of this message cold, distant, or strictly businesslike?"
      },
      {
        "id": "w_tone_terse",
        "q": "对方只回了一个字或极短的确认，比如「收到」「OK」「k」吗？",
        "qEn": "Is the other person replying with only a single word or a very short acknowledgement, such as \"noted\", \"OK\", or \"k\"?"
      }
    ],
    "friction": [
      {
        "id": "w_f_disappointment",
        "q": "对方在表达他自己的失望或不快，但没有具体怪我做错了哪件事吗？",
        "qEn": "Is the other person expressing their own disappointment or unease, without blaming me for any specific action?"
      },
      {
        "id": "w_f_specific",
        "q": "对方在为某件具体的延误、错误或结果怪我吗？",
        "qEn": "Is the other person blaming me for a specific delay, mistake, or result?"
      },
      {
        "id": "w_f_general",
        "q": "对方在泛泛地指责我的态度、一贯表现或动机吗？",
        "qEn": "Is the other person blaming me in general terms, such as my attitude, my usual behaviour, or my motives?"
      },
      {
        "id": "w_f_insult",
        "q": "对方在认真贬低、嘲讽或侮辱我这个人吗？",
        "qEn": "Is the other person seriously insulting, ridiculing, or showing contempt for me as a person?"
      },
      {
        "id": "w_f_threat",
        "q": "对方在威胁要报复、要让我难堪或要对我本人不利吗？",
        "qEn": "Is the other person threatening to retaliate, to humiliate me, or to harm me?"
      }
    ],
    "stances": [
      {
        "id": "w_accept_scope",
        "label": "先接范围、再谈时间",
        "labelEn": "Accept the scope first, then talk timing",
        "mustInclude": [
          "明确表示接下这件事",
          "给出一个具体的交付时间"
        ],
        "mustAvoid": [
          "无条件承诺什么时候都行"
        ],
        "commitments": [
          "我在几点前给第一版"
        ],
        "apology": "optional"
      },
      {
        "id": "w_more_time",
        "label": "说时间来不及，要更多时间",
        "labelEn": "Say the time is not possible, ask for more",
        "mustInclude": [
          "说明对方要的时间做不到",
          "提出需要更多时间"
        ],
        "mustAvoid": [
          "直接承诺一个新的交付日期"
        ],
        "commitments": [
          "我拿到新时间就立刻回你"
        ],
        "apology": "expected"
      },
      {
        "id": "w_acknowledge_fix",
        "label": "承认问题并处理",
        "labelEn": "Acknowledge the problem and fix it",
        "mustInclude": [
          "确认收到了对方指出的问题",
          "说明我会去处理"
        ],
        "mustAvoid": [
          "把责任推回给对方",
          "只说会看却不说什么时候"
        ],
        "commitments": [
          "我查清后回复处理结果"
        ],
        "apology": "expected"
      },
      {
        "id": "w_decline_extra",
        "label": "明确拒绝新增的活",
        "labelEn": "Decline the extra work outright",
        "mustInclude": [
          "说明我这件事接不了"
        ],
        "mustAvoid": [
          "答应只做一部分",
          "替别的同事做承诺"
        ],
        "commitments": [],
        "apology": "expected"
      }
    ]
  },
  "romance": {
    "label": "恋爱",
    "relationships": [
      "刚认识",
      "暧昧期",
      "约会中",
      "伴侣",
      "前任·仍是朋友",
      "前任·很少联系"
    ],
    "behaviours": [
      {
        "id": "r_shares_feeling",
        "q": "对方在说自己此刻的感受，而不是在怪我吗？",
        "qEn": "Is the other person describing how they feel right now, rather than blaming me?",
        "nextStep": "先接情绪，别急着给方案"
      },
      {
        "id": "r_flirts",
        "q": "对方在夸我或开玩笑式地撩我吗？",
        "qEn": "Is the other person complimenting me or teasing me in a flirtatious way?",
        "nextStep": "同频回一句，接得住就好"
      },
      {
        "id": "r_misses_you",
        "q": "对方在说想我、在想着我吗？",
        "qEn": "Is the other person saying they miss me or are thinking about me?",
        "nextStep": "按你们平时的亲密度回，别突然加码"
      },
      {
        "id": "r_says_love",
        "q": "对方在说爱我或喜欢我吗？",
        "qEn": "Is the other person saying they love me or have feelings for me?",
        "nextStep": "关系没到就轻轻接住，到了就直说"
      },
      {
        "id": "r_wants_meet",
        "q": "对方在提议见面、通话或一起做点什么吗？",
        "qEn": "Is the other person suggesting that we meet, call, or do something together?",
        "nextStep": "能见就给时间，见不了就给替代时间"
      },
      {
        "id": "r_complaint",
        "q": "对方在抱怨我做过或没做的某件事吗？",
        "qEn": "Is the other person complaining about something I did or did not do?",
        "nextStep": "先认具体那一件事，别解释一大堆"
      },
      {
        "id": "r_reassurance",
        "q": "对方在要一个安心，让我表态或证明我在乎吗？",
        "qEn": "Is the other person asking for reassurance, wanting me to declare or prove that I care?",
        "nextStep": "先给一句确定的在乎，再谈细节"
      },
      {
        "id": "r_boundary",
        "q": "对方在说需要空间，或让我别再联系、别再提某个话题吗？",
        "qEn": "Is the other person saying they need space, or asking me to stop contacting them or to drop a topic?",
        "nextStep": "照做，只回一句收到，不追问"
      },
      {
        "id": "r_ultimatum",
        "q": "对方在说不照做就分手或结束关系吗？",
        "qEn": "Is the other person saying the relationship will end unless I do what they ask?",
        "nextStep": "别赌气回，先降温，重要的话留到当面说"
      }
    ],
    "tone": [
      {
        "id": "r_tone_low_effort",
        "q": "对方只回了「哈哈」「嗯」「k」这类没给我接话空间的极短消息吗？",
        "qEn": "Is this a very short, low-effort reply such as \"lol\", \"haha\", or \"k\" that gives me nothing to respond to?"
      },
      {
        "id": "r_tone_displeasure",
        "q": "对方回的是「随便」「行吧」「我没事」这类在恋人之间常表示不满的短句吗？",
        "qEn": "Is this a short reply of the kind that often signals displeasure between two people who are romantically involved, such as \"whatever\", \"fine\", or \"I'm fine\"?"
      },
      {
        "id": "r_tone_cold",
        "q": "对方这条消息明显比平时冷淡或疏远吗？",
        "qEn": "Is this message noticeably colder or more distant than this person usually is?"
      }
    ],
    "friction": [
      {
        "id": "r_f_disappointment",
        "q": "对方在说他自己的难过或失望，但没有具体怪我做错了哪件事吗？",
        "qEn": "Is the other person expressing their own sadness or disappointment, without blaming me for any specific action?"
      },
      {
        "id": "r_f_specific",
        "q": "对方在为某件具体的事怪我吗？",
        "qEn": "Is the other person blaming me for a specific thing?"
      },
      {
        "id": "r_f_general",
        "q": "对方在泛泛地说我一贯如此、态度有问题或动机不纯吗？",
        "qEn": "Is the other person saying in general terms that I am always like this, or that my attitude or motives are wrong?"
      },
      {
        "id": "r_f_insult",
        "q": "对方在认真贬低、嘲讽或侮辱我这个人吗？",
        "qEn": "Is the other person seriously insulting, ridiculing, or showing contempt for me as a person?"
      },
      {
        "id": "r_f_threat",
        "q": "对方在威胁分手、惩罚我，或要把我的事说出去让我难堪吗？",
        "qEn": "Is the other person threatening to break up, to punish me, or to expose something in order to humiliate me?"
      }
    ],
    "stances": [
      {
        "id": "r_in_kind",
        "label": "同样温度回一句",
        "labelEn": "Reply in kind",
        "mustInclude": [
          "用你们平时的亲密语气回应",
          "回应对方说的那件事本身"
        ],
        "mustAvoid": [
          "突然升级到更重的表白",
          "用玩笑把话题岔开"
        ],
        "commitments": [],
        "apology": "optional"
      },
      {
        "id": "r_more_distance",
        "label": "先拉开一点距离",
        "labelEn": "Pull back a little",
        "mustInclude": [
          "说明现在不方便或不想推进",
          "把话说清楚但不伤人"
        ],
        "mustAvoid": [
          "留一个模糊的暗示",
          "批评对方不该提这件事"
        ],
        "commitments": [],
        "apology": "expected"
      },
      {
        "id": "r_not_now",
        "label": "现在不行，晚点再说",
        "labelEn": "Not now, we'll talk later",
        "mustInclude": [
          "说明现在没法谈这件事",
          "说清什么时候再谈"
        ],
        "mustAvoid": [
          "直接提分手或结束",
          "假装什么都没发生"
        ],
        "commitments": [
          "我晚点会主动找你谈"
        ],
        "apology": "expected"
      },
      {
        "id": "r_not_accept",
        "label": "先不接受道歉",
        "labelEn": "Don't accept the apology yet",
        "mustInclude": [
          "说明我还没准备好接受这个道歉"
        ],
        "mustAvoid": [
          "反过来道歉",
          "说没关系就这样吧"
        ],
        "commitments": [],
        "apology": "avoid"
      }
    ]
  },
  "friends": {
    "label": "朋友",
    "relationships": [
      "新朋友",
      "普通朋友",
      "好朋友"
    ],
    "behaviours": [
      {
        "id": "fr_invite",
        "q": "对方在邀请我参加某个活动或一起出去玩吗？",
        "qEn": "Is the other person inviting me to an event or to hang out?",
        "nextStep": "去不去都要给个明确答复"
      },
      {
        "id": "fr_vent",
        "q": "对方在倾诉自己的糟心事，但没有问我该怎么办吗？",
        "qEn": "Is the other person venting about their own problems without asking me what to do?",
        "nextStep": "先站他那边，别急着给建议"
      },
      {
        "id": "fr_tease",
        "q": "对方在拿我开玩笑或调侃我吗？",
        "qEn": "Is the other person teasing me or making a joke at my expense?",
        "nextStep": "看聊天记录里的习惯，接得住就接"
      },
      {
        "id": "fr_favour",
        "q": "对方在请我帮一个大忙吗？",
        "qEn": "Is the other person asking me for a big favour?",
        "nextStep": "帮不帮都要直接说，别用编的理由推"
      },
      {
        "id": "fr_cancel",
        "q": "对方在取消或放你们原本约好的事吗？",
        "qEn": "Is the other person cancelling or pulling out of a plan we had?",
        "nextStep": "先说没事，再决定要不要另约"
      },
      {
        "id": "fr_miss_you",
        "q": "对方在以朋友的身份说想我或在乎我吗？",
        "qEn": "Is the other person saying they miss me or care about me, as a friend?",
        "nextStep": "同分量回一句就够"
      },
      {
        "id": "fr_likes_you",
        "q": "对方在说对我有超出朋友的感情吗？",
        "qEn": "Is the other person saying they have romantic feelings for me?",
        "nextStep": "这题必须我本人先定方向，再起草回复"
      },
      {
        "id": "fr_swear",
        "q": "对方在骂我或对我说了带侮辱性的脏话吗？",
        "qEn": "Is the other person swearing at me or insulting me?",
        "nextStep": "先别回，想清楚要不要当场划线"
      }
    ],
    "tone": [
      {
        "id": "fr_tone_displeasure",
        "q": "对方回的是「随便」「行吧」「算了」这类在闹别扭时常表示不满的短句吗？",
        "qEn": "Is this a short reply of the kind that often signals displeasure after a disagreement, such as \"whatever\", \"fine\", or \"forget it\"?"
      },
      {
        "id": "fr_tone_short",
        "q": "对方只回了一个极短的确认，明显比平时冷吗？",
        "qEn": "Is this only a very short acknowledgement, noticeably colder than usual?"
      },
      {
        "id": "fr_tone_sarcastic",
        "q": "对方这句话是带着讽刺或阴阳怪气说的吗？",
        "qEn": "Is the other person saying this sarcastically or with a mocking edge?"
      }
    ],
    "friction": [
      {
        "id": "fr_f_disappointment",
        "q": "对方在说他自己不高兴或失望，但没有具体怪我做错了哪件事吗？",
        "qEn": "Is the other person expressing their own unhappiness or disappointment, without blaming me for any specific action?"
      },
      {
        "id": "fr_f_specific",
        "q": "对方在为某件具体的事怪我吗？",
        "qEn": "Is the other person blaming me for a specific thing?"
      },
      {
        "id": "fr_f_general",
        "q": "对方在泛泛地指责我一贯如此、人品或动机有问题吗？",
        "qEn": "Is the other person saying in general terms that I am always like this, or that my character or motives are bad?"
      },
      {
        "id": "fr_f_insult",
        "q": "对方在认真贬低、嘲讽或侮辱我这个人吗？",
        "qEn": "Is the other person seriously insulting, ridiculing, or showing contempt for me as a person?"
      },
      {
        "id": "fr_f_threat",
        "q": "对方在威胁要跟我绝交、要让我难堪，或要把我的事说出去吗？",
        "qEn": "Is the other person threatening to end the friendship, to humiliate me, or to expose something about me?"
      }
    ],
    "stances": [
      {
        "id": "fr_not_going",
        "label": "这次去不了",
        "labelEn": "Can't make it this time",
        "mustInclude": [
          "说明这次去不了"
        ],
        "mustAvoid": [
          "编造一个不存在的理由"
        ],
        "commitments": [],
        "apology": "expected"
      },
      {
        "id": "fr_no_worries",
        "label": "没事，别放心上",
        "labelEn": "No worries",
        "mustInclude": [
          "表示不介意对方取消"
        ],
        "mustAvoid": [
          "借机表达不满"
        ],
        "commitments": [],
        "apology": "optional"
      },
      {
        "id": "fr_not_funny",
        "label": "这个玩笑我不喜欢",
        "labelEn": "I don't like that joke",
        "mustInclude": [
          "说明我不觉得这个玩笑好笑"
        ],
        "mustAvoid": [
          "跟着一起自嘲"
        ],
        "commitments": [],
        "apology": "avoid"
      },
      {
        "id": "fr_stand_firm",
        "label": "我还是这个看法",
        "labelEn": "Stand by my view",
        "mustInclude": [
          "说明我仍然坚持自己的看法"
        ],
        "mustAvoid": [
          "为坚持看法道歉",
          "说对方是错的"
        ],
        "commitments": [],
        "apology": "avoid"
      }
    ]
  },
  "family": {
    "label": "家人",
    "relationships": [
      "父母或长辈",
      "兄弟姐妹或同辈",
      "孩子或晚辈",
      "伴侣的家人"
    ],
    "behaviours": [
      {
        "id": "fa_checks_you",
        "q": "对方在问我吃没吃、睡没睡、身体好不好吗？",
        "qEn": "Is the other person asking whether I am eating, sleeping, or keeping well?",
        "nextStep": "简短回一句具体的实话"
      },
      {
        "id": "fa_personal_decision",
        "q": "对方在过问我的个人决定，比如工作、对象或要不要孩子吗？",
        "qEn": "Is the other person asking about a personal decision of mine, such as my job, my partner, or having children?",
        "nextStep": "谈不谈由我定，不想谈就客气挡回去"
      },
      {
        "id": "fa_advice",
        "q": "对方在我没问的情况下告诉我应该怎么做吗？",
        "qEn": "Is the other person telling me what I should do when I did not ask?",
        "nextStep": "先谢一句，再说我自己的打算"
      },
      {
        "id": "fa_visit_or_call",
        "q": "对方在要我回家、回去看看或打电话吗？",
        "qEn": "Is the other person asking me to come home, to visit, or to call?",
        "nextStep": "去不去都要给个明确时间"
      },
      {
        "id": "fa_asks_help",
        "q": "对方在要我出钱、出力或帮忙办事吗？",
        "qEn": "Is the other person asking me for money, for practical help, or to run an errand?",
        "nextStep": "能帮到什么程度说清楚，别含糊"
      },
      {
        "id": "fa_worried",
        "q": "对方在说他担心我吗？",
        "qEn": "Is the other person saying they are worried about me?",
        "nextStep": "先让他安心，别报一堆细节"
      },
      {
        "id": "fa_guilt",
        "q": "对方在说或暗示我没尽到家里的责任吗？",
        "qEn": "Is the other person saying or implying that I am failing a duty to the family?",
        "nextStep": "这是施压线索，接情绪但不认罪"
      },
      {
        "id": "fa_compares",
        "q": "对方在拿我和别人比、说我不如谁吗？",
        "qEn": "Is the other person comparing me unfavourably with someone else?",
        "nextStep": "别接比较的框架，只回你自己的安排"
      },
      {
        "id": "fa_teases",
        "q": "对方在调侃我或拿我开玩笑吗？",
        "qEn": "Is the other person teasing me or joking at my expense?",
        "nextStep": "看家里的习惯，能接就接"
      }
    ],
    "tone": [
      {
        "id": "fa_tone_displeasure",
        "q": "对方回的是「随便你」「行了」这类刚闹过别扭时常表示不满的短句吗？",
        "qEn": "Is this a short reply of the kind that often signals displeasure just after a disagreement, such as \"suit yourself\" or \"fine\"?"
      },
      {
        "id": "fa_tone_cold",
        "q": "对方这条消息比平时冷淡或疏远吗？",
        "qEn": "Is this message colder or more distant than this person usually is?"
      },
      {
        "id": "fa_tone_perfunctory",
        "q": "对方只回了一个极短的确认，明显是在敷衍吗？",
        "qEn": "Is this only a very short acknowledgement, clearly perfunctory?"
      }
    ],
    "friction": [
      {
        "id": "fa_f_disappointment",
        "q": "对方在说他自己失望或难过，但没有具体怪我做错了哪件事吗？",
        "qEn": "Is the other person expressing their own disappointment or sadness, without blaming me for any specific action?"
      },
      {
        "id": "fa_f_specific",
        "q": "对方在为某件具体的事怪我吗？",
        "qEn": "Is the other person blaming me for a specific thing?"
      },
      {
        "id": "fa_f_general",
        "q": "对方在泛泛地指责我一贯不孝、不顾家或没良心吗？",
        "qEn": "Is the other person saying in general terms that I am unfilial, that I neglect the family, or that I have no conscience?"
      },
      {
        "id": "fa_f_insult",
        "q": "对方在认真贬低、嘲讽或侮辱我这个人吗？",
        "qEn": "Is the other person seriously insulting, ridiculing, or showing contempt for me as a person?"
      },
      {
        "id": "fa_f_threat",
        "q": "对方在威胁要断绝关系、要惩罚我，或要把我的事说给亲戚让我难堪吗？",
        "qEn": "Is the other person threatening to cut me off, to punish me, or to tell the relatives something in order to humiliate me?"
      }
    ],
    "stances": [
      {
        "id": "fa_acknowledge_no_yield",
        "label": "接下情绪，但不松口",
        "labelEn": "Acknowledge, don't give way",
        "mustInclude": [
          "确认听懂了对方的感受",
          "说明我的决定不变"
        ],
        "mustAvoid": [
          "为坚持自己的决定道歉",
          "反过来指责对方"
        ],
        "commitments": [],
        "apology": "avoid"
      },
      {
        "id": "fa_no",
        "label": "说不",
        "labelEn": "Say no",
        "mustInclude": [
          "清楚说明这次帮不了或去不了"
        ],
        "mustAvoid": [
          "编造理由",
          "含糊拖着不给答复"
        ],
        "commitments": [],
        "apology": "expected"
      },
      {
        "id": "fa_my_decision",
        "label": "告诉他们我已经定了",
        "labelEn": "Tell them I have already decided",
        "mustInclude": [
          "说明这件事我已经决定了"
        ],
        "mustAvoid": [
          "把决定说成还可以商量",
          "为这个决定道歉"
        ],
        "commitments": [],
        "apology": "avoid"
      },
      {
        "id": "fa_give_way",
        "label": "顺着他们",
        "labelEn": "Give way",
        "mustInclude": [
          "说明我按对方说的做"
        ],
        "mustAvoid": [
          "嘴上答应心里留条件"
        ],
        "commitments": [
          "我会按你说的安排去做"
        ],
        "apology": "optional"
      }
    ]
  },
  "general": {
    "label": "通用",
    "relationships": [
      "不确定",
      "办事与服务"
    ],
    "behaviours": [
      {
        "id": "g_asks_question",
        "q": "对方在问我一个需要我回答的问题吗？",
        "qEn": "Is the other person asking me a question that I am expected to answer?",
        "nextStep": "直接回答，答不了就说什么时候能答"
      },
      {
        "id": "g_plans_time",
        "q": "对方在约时间、提议安排或问我什么时候方便吗？",
        "qEn": "Is the other person proposing a time or an arrangement, or asking when I am free?",
        "nextStep": "给具体时间，别回「都行」"
      },
      {
        "id": "g_asks_favour",
        "q": "对方在请我帮他做一件事吗？",
        "qEn": "Is the other person asking me to do something for them?",
        "nextStep": "帮不帮都直接说"
      },
      {
        "id": "g_complaint",
        "q": "对方在抱怨我做过或没做的某件事吗？",
        "qEn": "Is the other person complaining about something I did or did not do?",
        "nextStep": "先确认收到，再给处理方式"
      },
      {
        "id": "g_boundary",
        "q": "对方在说需要空间，或让我别再联系、别再提某件事吗？",
        "qEn": "Is the other person saying they need space, or asking me to stop contacting them or to drop a topic?",
        "nextStep": "照做，只回一句收到"
      },
      {
        "id": "g_turns_down",
        "q": "对方在拒绝我的提议，而且没给别的选择吗？",
        "qEn": "Is the other person turning down my suggestion without offering another option?",
        "nextStep": "别再追一次，先接受"
      },
      {
        "id": "g_price_terms",
        "q": "对方在报价、说费用或讲条件吗？",
        "qEn": "Is the other person stating a price, a fee, or terms?",
        "nextStep": "先复述一遍条件，别急着答应"
      },
      {
        "id": "g_pay",
        "q": "对方在要我现在付钱或付定金吗？",
        "qEn": "Is the other person asking me to pay now or to send a deposit?",
        "nextStep": "没问清楚前一律先不付"
      },
      {
        "id": "g_documents",
        "q": "对方在要我的证件、材料或个人资料吗？",
        "qEn": "Is the other person asking me for documents or personal details?",
        "nextStep": "先问清用途，再决定给什么"
      },
      {
        "id": "g_pressure_decide",
        "q": "对方在催我尽快决定，或在说还有别人想要吗？",
        "qEn": "Is the other person pushing me to decide quickly, or saying that someone else is interested?",
        "nextStep": "这是催单话术，不给当场决定"
      }
    ],
    "tone": [
      {
        "id": "g_tone_cold",
        "q": "对方这条消息的语气是冷淡、生硬或公事公办的吗？",
        "qEn": "Is the tone of this message cold, blunt, or strictly businesslike?"
      },
      {
        "id": "g_tone_pressuring",
        "q": "对方这条消息的语气明显在催我或给我压力吗？",
        "qEn": "Does the tone of this message clearly push or pressure me?"
      },
      {
        "id": "g_tone_formal",
        "q": "对方用的是正式的书面或客服口径，而不是日常说话的语气吗？",
        "qEn": "Is the other person using formal written or customer-service wording rather than everyday speech?"
      }
    ],
    "friction": [
      {
        "id": "g_f_disappointment",
        "q": "对方在表达他自己的不满或失望，但没有具体怪我做错了哪件事吗？",
        "qEn": "Is the other person expressing their own dissatisfaction or disappointment, without blaming me for any specific action?"
      },
      {
        "id": "g_f_specific",
        "q": "对方在为某件具体的事怪我吗？",
        "qEn": "Is the other person blaming me for a specific thing?"
      },
      {
        "id": "g_f_general",
        "q": "对方在泛泛地指责我不靠谱、态度差或别有用心吗？",
        "qEn": "Is the other person saying in general terms that I am unreliable, that my attitude is bad, or that I have an ulterior motive?"
      },
      {
        "id": "g_f_insult",
        "q": "对方在认真贬低、嘲讽或侮辱我这个人吗？",
        "qEn": "Is the other person seriously insulting, ridiculing, or showing contempt for me as a person?"
      },
      {
        "id": "g_f_threat",
        "q": "对方在威胁要报复、要投诉我或要让我难堪吗？",
        "qEn": "Is the other person threatening to retaliate, to report me, or to humiliate me?"
      }
    ],
    "stances": [
      {
        "id": "g_time_no",
        "label": "这个时间不行",
        "labelEn": "That time doesn't work",
        "mustInclude": [
          "说明对方提的时间不方便"
        ],
        "mustAvoid": [
          "只说不行却不给下一步"
        ],
        "commitments": [],
        "apology": "expected"
      },
      {
        "id": "g_no",
        "label": "帮不了",
        "labelEn": "Can't help with this",
        "mustInclude": [
          "清楚说明这次帮不上"
        ],
        "mustAvoid": [
          "编造理由"
        ],
        "commitments": [],
        "apology": "expected"
      },
      {
        "id": "g_counter",
        "label": "还价或加个条件",
        "labelEn": "Counter-offer or add a condition",
        "mustInclude": [
          "提出我的价格或条件"
        ],
        "mustAvoid": [
          "直接接受对方的报价或条件"
        ],
        "commitments": [],
        "apology": "avoid"
      },
      {
        "id": "g_need_time",
        "label": "我需要时间，先问几个问题",
        "labelEn": "I need time, questions first",
        "mustInclude": [
          "说明现在还不能定",
          "问清我需要知道的信息"
        ],
        "mustAvoid": [
          "当场答应或付款"
        ],
        "commitments": [],
        "apology": "avoid"
      }
    ]
  }
}
