import type { CourseChunk, KnowledgeCard, KnowledgeConcept, MasteryRecord, ParsedDocument, QuizQuestion } from "../types";
import { conceptIdFromName } from "../services/masteryService";

export const courseMeta = {
  name: "机器学习基础",
  documentName: "machine_learning_intro.md"
};

export const demoMarkdown = `# 机器学习基础

## 链式法则

链式法则用于计算复合函数的导数。如果 $y=f(g(x))$，则：

$$
\\frac{dy}{dx}=f'(g(x))\\cdot g'(x)
$$

## 梯度

梯度由函数对各个变量的偏导数组成，指向函数值上升最快的方向。

## 梯度下降

梯度下降沿着负梯度方向迭代更新参数，用于逐步降低损失函数：

$$
\\theta_{t+1}=\\theta_t-\\eta\\nabla L(\\theta_t)
$$

## 损失函数

损失函数衡量模型预测和真实标签之间的差距，是训练时需要最小化的目标。

## 神经网络

神经网络由多层线性变换和非线性激活组成，可以看成一层套一层的复合函数。

## 反向传播

反向传播从输出层开始，利用链式法则把损失函数对各层参数的梯度逐层向前传递。`;

export const initialConcepts: KnowledgeConcept[] = [
  { id: "chain_rule", name: "链式法则", category: "数学基础", status: "existing" },
  { id: "gradient", name: "梯度", category: "数学基础", status: "existing" },
  { id: "gradient_descent", name: "梯度下降", category: "机器学习基础", status: "existing" },
  { id: "loss_function", name: "损失函数", category: "机器学习基础", status: "existing" },
  { id: "neural_network", name: "神经网络", category: "深度学习", status: "existing" },
  { id: "backpropagation", name: "反向传播", category: "深度学习", status: "existing" }
];

export const conceptNameById = Object.fromEntries(initialConcepts.map((concept) => [concept.id, concept.name]));

export const initialChunks: CourseChunk[] = [
  {
    id: "chunk_chain_rule",
    section: "链式法则章节",
    content: "链式法则用于计算复合函数的导数。如果 $y=f(g(x))$，则 $\\frac{dy}{dx}=f'(g(x))\\cdot g'(x)$。",
    concepts: ["chain_rule"],
    source: { document: "机器学习基础资料", section: "链式法则章节", chunkId: "chunk_chain_rule" }
  },
  {
    id: "chunk_gradient",
    section: "梯度章节",
    content: "梯度由函数对各个变量的偏导数组成，指向函数值上升最快的方向。",
    concepts: ["gradient"],
    source: { document: "机器学习基础资料", section: "梯度章节", chunkId: "chunk_gradient" }
  },
  {
    id: "chunk_gradient_descent",
    section: "梯度下降章节",
    content: "梯度下降沿着负梯度方向迭代更新参数，用于逐步降低损失函数：$\\theta_{t+1}=\\theta_t-\\eta\\nabla L(\\theta_t)$。",
    concepts: ["gradient_descent", "gradient", "loss_function"],
    source: { document: "机器学习基础资料", section: "梯度下降章节", chunkId: "chunk_gradient_descent" }
  },
  {
    id: "chunk_loss",
    section: "损失函数章节",
    content: "损失函数衡量模型预测和真实标签之间的差距，是训练时需要最小化的目标。",
    concepts: ["loss_function"],
    source: { document: "机器学习基础资料", section: "损失函数章节", chunkId: "chunk_loss" }
  },
  {
    id: "chunk_network",
    section: "神经网络章节",
    content: "神经网络由多层线性变换和非线性激活组成，可以看成一层套一层的复合函数。",
    concepts: ["neural_network", "chain_rule"],
    source: { document: "机器学习基础资料", section: "神经网络章节", chunkId: "chunk_network" }
  },
  {
    id: "chunk_backprop",
    section: "反向传播章节",
    content: "反向传播从输出层开始，利用链式法则把损失函数对各层参数的梯度逐层向前传递。",
    concepts: ["backpropagation", "chain_rule", "gradient", "loss_function"],
    source: { document: "机器学习基础资料", section: "反向传播章节", chunkId: "chunk_backprop" }
  }
];

export const builtInDocument: ParsedDocument = {
  id: "doc_builtin",
  fileName: courseMeta.documentName,
  fileType: "md",
  status: "ready",
  text: demoMarkdown,
  chunks: initialChunks,
  concepts: initialConcepts,
  updatedAt: "内置示例"
};

export const initialMastery: MasteryRecord[] = [
  { conceptId: "chain_rule", conceptName: "链式法则", score: 0.28, lastEvent: "诊断题答错：复合函数求导规则不稳" },
  { conceptId: "backpropagation", conceptName: "反向传播", score: 0.35, lastEvent: "诊断题能识别目标，但解释不完整" },
  { conceptId: "gradient", conceptName: "梯度", score: 0.58, lastEvent: "诊断题答对：理解梯度方向" },
  { conceptId: "gradient_descent", conceptName: "梯度下降", score: 0.62, lastEvent: "课后练习记录：能做基础题" },
  { conceptId: "loss_function", conceptName: "损失函数", score: 0.52, lastEvent: "课程资料阅读记录" },
  { conceptId: "neural_network", conceptName: "神经网络", score: 0.48, lastEvent: "课程资料阅读记录" }
];

export const initialCards: KnowledgeCard[] = [
  {
    id: "chain_rule",
    name: "链式法则",
    category: "数学基础",
    summary: "用于计算复合函数导数的规则。",
    intuition: "当一个变量通过中间变量间接影响结果时，需要把每一段影响连续相乘。",
    formula: "$$\\frac{dy}{dx}=\\frac{dy}{du}\\cdot\\frac{du}{dx}$$",
    example: "如果 $y=(3x+1)^2$，令 $u=3x+1$，则 $\\frac{dy}{dx}=2u\\cdot3=6(3x+1)$。",
    commonMistakes: ["只对外层函数求导，忘记乘以内层函数的导数。"],
    prerequisites: ["函数", "导数", "复合函数"],
    relatedConcepts: ["梯度", "反向传播"],
    source: "机器学习基础资料：链式法则章节",
    masterySuggestion: "听过但不稳"
  },
  {
    id: "gradient",
    name: "梯度",
    category: "数学基础",
    summary: "由多变量函数各方向偏导数组成的向量。",
    intuition: "梯度像一支指针，指向函数值上升最快的方向；负梯度方向通常用于下降损失。",
    formula: "$$\\nabla f(x)=[\\partial f/\\partial x_1,\\partial f/\\partial x_2,\\ldots]$$",
    example: "若 $f(w,b)=w^2+b^2$，则 $\\nabla f=[2w,2b]$。",
    commonMistakes: ["把梯度方向误认为函数下降最快方向；实际下降最快方向是负梯度。"],
    prerequisites: ["导数", "偏导数"],
    relatedConcepts: ["梯度下降", "反向传播", "损失函数"],
    source: "机器学习基础资料：梯度章节",
    masterySuggestion: "基本理解"
  },
  {
    id: "gradient_descent",
    name: "梯度下降",
    category: "机器学习基础",
    summary: "沿负梯度方向迭代更新参数以降低损失的方法。",
    intuition: "像沿着山坡最陡的下坡方向小步走，直到接近低谷。",
    formula: "$$\\theta_{t+1}=\\theta_t-\\eta\\nabla L(\\theta_t)$$",
    example: "若当前梯度为 0.6、学习率为 0.1，则参数沿负方向更新 0.06。",
    commonMistakes: ["学习率越大越好；过大可能越过最低点甚至发散。"],
    prerequisites: ["梯度", "损失函数"],
    relatedConcepts: ["梯度", "损失函数", "反向传播"],
    source: "机器学习基础资料：梯度下降章节",
    masterySuggestion: "能做基础题"
  },
  {
    id: "loss_function",
    name: "损失函数",
    category: "机器学习基础",
    summary: "衡量模型预测结果与真实结果差距的函数。",
    intuition: "损失函数给模型的错误打分，训练目标就是让这个分数尽量小。",
    formula: "$$L=\\frac{1}{n}\\sum_i(\\hat y_i-y_i)^2$$",
    example: "预测 8、真实 10，则平方误差为 4。",
    commonMistakes: ["只看准确率而忽略损失；损失提供了可求导的优化信号。"],
    prerequisites: ["函数", "模型预测"],
    relatedConcepts: ["梯度", "梯度下降", "反向传播"],
    source: "机器学习基础资料：损失函数章节",
    masterySuggestion: "基本理解"
  },
  {
    id: "neural_network",
    name: "神经网络",
    category: "深度学习",
    summary: "由多层参数化变换和激活函数组成的模型。",
    intuition: "每一层把输入加工成更有用的表示，多层叠加后形成复杂函数。",
    formula: "$$a_l=\\sigma(W_la_{l-1}+b_l)$$",
    example: "图片像素经过多层变换，最终输出各类别的预测分数。",
    commonMistakes: ["把神经网络看作黑箱，忽略它本质上是可求导的复合函数。"],
    prerequisites: ["线性函数", "激活函数", "损失函数"],
    relatedConcepts: ["反向传播", "链式法则", "梯度"],
    source: "机器学习基础资料：神经网络章节",
    masterySuggestion: "基本理解"
  },
  {
    id: "backpropagation",
    name: "反向传播",
    category: "深度学习",
    summary: "用链式法则高效计算神经网络各层参数梯度的算法。",
    intuition: "从损失出发，把误差信号沿网络结构反向传回每一层，告诉每个参数该如何调整。",
    formula: "$$\\frac{\\partial L}{\\partial W_l}=\\frac{\\partial L}{\\partial a_l}\\frac{\\partial a_l}{\\partial z_l}\\frac{\\partial z_l}{\\partial W_l}$$",
    example: "输出层误差先得到最后一层权重梯度，再继续传到前一层。",
    commonMistakes: ["认为反向传播是在反向执行预测；实际它是在反向传播梯度。"],
    prerequisites: ["链式法则", "梯度", "损失函数", "神经网络"],
    relatedConcepts: ["链式法则", "梯度", "损失函数", "神经网络"],
    source: "机器学习基础资料：反向传播章节",
    masterySuggestion: "听过但不稳"
  }
];

export const builtInQuizBank: QuizQuestion[] = [
  {
    id: "q_chain_basic",
    type: "single_choice",
    difficulty: "basic",
    conceptNames: ["链式法则"],
    questionMarkdown: "如果 $y=f(g(x))$，要求 $y$ 对 $x$ 的导数，应使用什么法则？",
    options: [
      { id: "A", textMarkdown: "乘法交换律" },
      { id: "B", textMarkdown: "链式法则" },
      { id: "C", textMarkdown: "贝叶斯公式" },
      { id: "D", textMarkdown: "欧拉公式" }
    ],
    answer: "B",
    explanationMarkdown: "复合函数求导需要使用链式法则：$\\frac{dy}{dx}=\\frac{dy}{du}\\cdot\\frac{du}{dx}$。",
    source: "built-in"
  },
  {
    id: "q_chain_formula_render",
    type: "single_choice",
    difficulty: "basic",
    conceptNames: ["链式法则"],
    questionMarkdown: "若 $y=(3x+1)^2$，则 $\\frac{dy}{dx}$ 等于多少？",
    options: [
      { id: "A", textMarkdown: "$2(3x+1)$" },
      { id: "B", textMarkdown: "$6(3x+1)$" },
      { id: "C", textMarkdown: "$3x+1$" },
      { id: "D", textMarkdown: "$9x^2$" }
    ],
    answer: "B",
    explanationMarkdown: "令 $u=3x+1$，则 $y=u^2$，所以 $$\\frac{dy}{dx}=2u\\cdot 3=6(3x+1)$$。",
    source: "built-in"
  },
  {
    id: "q_gradient_basic",
    type: "single_choice",
    difficulty: "basic",
    conceptNames: ["梯度"],
    questionMarkdown: "梯度的方向表示什么？",
    options: [
      { id: "A", textMarkdown: "函数值下降最快的方向" },
      { id: "B", textMarkdown: "函数值上升最快的方向" },
      { id: "C", textMarkdown: "函数值不变的方向" },
      { id: "D", textMarkdown: "参数个数最多的方向" }
    ],
    answer: "B",
    explanationMarkdown: "梯度指向函数值上升最快方向，负梯度方向才用于下降损失。",
    source: "built-in"
  },
  {
    id: "q_backprop_basic",
    type: "single_choice",
    difficulty: "basic",
    conceptNames: ["反向传播"],
    questionMarkdown: "反向传播的核心目标是什么？",
    options: [
      { id: "A", textMarkdown: "随机初始化参数" },
      { id: "B", textMarkdown: "计算损失函数对各层参数的梯度" },
      { id: "C", textMarkdown: "增加训练样本数量" },
      { id: "D", textMarkdown: "删除神经网络隐藏层" }
    ],
    answer: "B",
    explanationMarkdown: "反向传播的核心是利用链式法则高效计算各层参数梯度。",
    source: "built-in"
  },
  {
    id: "q_gradient_descent_medium",
    type: "true_false",
    difficulty: "medium",
    conceptNames: ["梯度下降", "梯度"],
    questionMarkdown: "判断：梯度下降沿着梯度方向更新参数，因为梯度方向能最快降低损失。",
    options: [
      { id: "A", textMarkdown: "正确" },
      { id: "B", textMarkdown: "错误" }
    ],
    answer: "B",
    explanationMarkdown: "错误。梯度方向是函数上升最快方向，梯度下降应沿 **负梯度方向** 更新：$\\theta=\\theta-\\eta\\nabla L(\\theta)$。",
    source: "built-in"
  },
  {
    id: "q_loss_medium",
    type: "single_choice",
    difficulty: "medium",
    conceptNames: ["损失函数", "梯度下降"],
    questionMarkdown: "在监督学习训练中，损失函数最主要的作用是？",
    options: [
      { id: "A", textMarkdown: "衡量预测与真实标签的差距，并提供优化目标" },
      { id: "B", textMarkdown: "决定训练数据的存储格式" },
      { id: "C", textMarkdown: "保证模型一定不会过拟合" },
      { id: "D", textMarkdown: "替代所有评价指标" }
    ],
    answer: "A",
    explanationMarkdown: "损失函数是可优化目标，梯度下降通过降低损失来更新参数。",
    source: "built-in"
  },
  {
    id: "q_backprop_multi",
    type: "multiple_choice",
    difficulty: "advanced",
    conceptNames: ["反向传播", "链式法则"],
    questionMarkdown: "关于反向传播和链式法则，下列哪些说法正确？",
    options: [
      { id: "A", textMarkdown: "神经网络整体可以看作多层复合函数。" },
      { id: "B", textMarkdown: "反向传播会计算损失函数对各层参数的梯度。" },
      { id: "C", textMarkdown: "链式法则只适用于一元一次函数。" },
      { id: "D", textMarkdown: "梯度传递时会反复使用 $\\frac{dy}{dx}=\\frac{dy}{du}\\cdot\\frac{du}{dx}$。" }
    ],
    answer: ["A", "B", "D"],
    explanationMarkdown: "A、B、D 正确。C 错在链式法则适用于复合函数求导，不限于一元一次函数。",
    source: "built-in"
  }
];

export function getConceptName(id: string): string {
  return conceptNameById[id] ?? id;
}

export function ensureConceptId(name: string): string {
  const existing = initialConcepts.find((concept) => concept.name === name);
  return existing?.id ?? conceptIdFromName(name);
}
