"""
POSCOMP topic taxonomy + keyword classifier.

The exam is only split into three coarse areas (matematica / fundamentos /
tecnologia), which is far too broad to steer studying: "Fundamentos" alone
spans autos and automata, cache hierarchies, Karnaugh maps and Scrum. This
module breaks each area down into the topics of the official SBC ementa and
classifies a question by scoring keyword hits in its extracted text.

Keywords are matched against text that has been accent-stripped and
lowercased (see `normalize`), so patterns must be written accent-free. This
is deliberate: the pre-2004 cadernos are LaTeX PDFs whose text layer splits
diacritics into separate glyphs ("fun¸c˜ao"), and the 2002/2003 Fundamentos
booklets have to be OCRed with English tessdata, which mangles accents too.
Dropping accents everywhere makes all three sources comparable.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# weights: a pattern that only ever appears in one topic scores STRONG; one
# that is suggestive but shared across topics ("memoria", "arvore") scores
# WEAK so it can only tip a decision, never make it on its own.
STRONG = 3
WEAK = 1


@dataclass
class Topic:
    slug: str
    label: str
    area: str  # primary area, for grouping in the UI
    strong: list[str] = field(default_factory=list)
    weak: list[str] = field(default_factory=list)


# NOTE: patterns are regexes. \b anchors matter a lot for short tokens
# ("ip", "so", "np") which would otherwise match inside unrelated words.
TOPICS: list[Topic] = [
    # ---------------------------------------------------------------- matematica
    Topic(
        "logica",
        "Logica Matematica",
        "matematica",
        strong=[
            r"tabela[- ]verdade", r"proposicao", r"proposicional", r"tautologi",
            r"contradicao logica", r"quantificador", r"silogismo", r"contrapositiva",
            r"logica de predicados", r"forma normal conjuntiva", r"forma normal disjuntiva",
            r"conectivo", r"bicondicional", r"implicacao logica", r"contingencia",
            r"leis de de morgan", r"de morgan", r"logicamente equivalente", r"valor de verdade",
            r"linguagem simbolica", r"negacao d[ae] senten", r"sentencas?\b",
            r"regras? de inferencia", r"\bpremissas?\b", r"expressao logica",
            r"logica proposicional", r"\bmodus ponens\b", r"\bmodus tollens\b",
            r"formula bem formada", r"\bsatisfativel\b", r"\bfalaci",
            r"logica de primeira ordem", r"linguagem de primeira ordem", r"\breciproca\b",
            r"predicados? unario", r"predicados? binario", r"negacao da frase",
            r"negacao da seguinte", r"\bafirmativa falsa\b", r"\bproposicoes\b",
        ],
        weak=[r"\bse e somente se\b", r"negacao", r"disjuncao", r"conjuncao", r"inferencia valida", r"argumento valido", r"\bconclusao\b"],
    ),
    Topic(
        "conjuntos-relacoes-funcoes",
        "Conjuntos, Relacoes e Funcoes",
        "matematica",
        strong=[
            r"relacao de equivalencia", r"classe de equivalencia", r"relacao reflexiva",
            r"antissimetrica", r"anti-simetrica", r"ordem parcial", r"reticulado",
            r"conjunto potencia", r"conjunto das partes", r"cardinalidade",
            r"bijetora", r"injetora", r"sobrejetora", r"bijetiva", r"injetiva", r"sobrejetiva",
            r"funcao inversa", r"produto cartesiano", r"fechamento transitivo",
            r"particao do conjunto", r"enumeravel", r"\be uma particao\b",
            r"operaco?e?s? binaria", r"elemento neutro", r"\bcomutativa\b",
            r"\bassociativa\b", r"\bdistributiva\b", r"\bmonoide\b", r"\bsemigrupo\b",
            r"\bgrupo abeliano\b", r"\baritmetica modular\b", r"\bcongruencia modulo\b",
            r"\bmaximo divisor comum\b", r"\bmdc\b", r"\bmmc\b", r"\bnumeros primos\b",
            r"\bconjuntos\b", r"\bsubconjuntos?\b", r"conjuntos disjuntos", r"conjuntos finitos",
            r"regiao sombreada", r"diagrama de venn", r"\bdivisiveis por\b", r"\bdivisores\b",
            r"\bresto da divisao\b", r"\belementos distintos\b", r"\bpertence ao conjunto\b",
            r"\bconjunto a\b", r"\bconjunto s\b", r"\bnumeros inteiros\b", r"\bponto fixo\b",
            r"\benquete\b", r"pesquisa realizada com", r"conjunto diferenca",
            r"\bintervalo aberto\b", r"\bintervalo fechado\b",
        ],
        weak=[r"reflexiva", r"simetrica", r"transitiva", r"\bconjunto\b", r"uniao", r"interseccao", r"intersecao", r"complemento", r"dominio", r"contradomini", r"imagem da funcao", r"\balgarismos\b", r"\bnumeros reais\b"],
    ),
    Topic(
        "inducao-recorrencia",
        "Inducao e Recorrencias",
        "matematica",
        strong=[
            r"inducao matematica", r"inducao finita", r"por inducao", r"hipotese de inducao",
            r"relacao de recorrencia", r"equacao de recorrencia", r"recorrencia\b",
            r"passo base", r"caso base da inducao", r"progressao aritmetica", r"progressao geometrica",
            r"somatorio de", r"fibonacci", r"definida recursivamente", r"definicao recursiva",
            r"funcao de ackermann", r"\bn-?esimo termo\b", r"teorema binomial",
            r"\bsomatorio", r"\bsomatorios\b", r"\bsequencia\b.*\bdefinida\b",
        ],
        weak=[r"formula fechada", r"termo geral", r"\bsequencia\b"],
    ),
    Topic(
        "combinatoria",
        "Analise Combinatoria",
        "matematica",
        strong=[
            r"analise combinatoria", r"permutacao", r"permutacoes", r"combinacoes de",
            r"arranjo", r"fatorial", r"casa dos pombos", r"principio da inclusao",
            r"binomio de newton", r"coeficiente binomial", r"triangulo de pascal",
            r"anagram", r"quantas maneiras", r"quantos modos", r"quantas formas",
            r"quant[oa]s \w+ (?:diferentes|distintas|distintos|possiveis)",
            r"\burna\b", r"principio multiplicativo", r"principio aditivo",
            r"\bpermutar\b", r"\bagrupamentos\b", r"quantas cadeias", r"quantas strings",
            r"quantos numeros inteiros", r"quantas equipes", r"quantas comissoes",
            r"sequencias de bits", r"strings binarias", r"string ternaria", r"\bpalindromo",
            r"\bsorteados\b", r"\bmega-?sena\b", r"\bcomissoes\b", r"quantos subconjuntos",
            r"quantas possiveis", r"quantas sao as", r"quantos sao os", r"\bcadeias de \d+ bits\b",
            r"\bnumero de sequencias\b", r"\bnumero de strings\b", r"\bnumero de gabaritos\b",
            r"solucoes inteiras", r"pelo menos \d+ (?:candidatos|pessoas|elementos)",
            r"\bcoeficientes binomiais\b", r"\bdigitos numericos\b",
            r"caracteres podem ser", r"\bcircuito equestre\b",
        ],
        weak=[r"quantidade de maneiras", r"\bdistintas\b.*\bordenar\b", r"\bbolas\b", r"\bsenhas\b", r"\bquantas\b", r"\bquantos\b"],
    ),
    Topic(
        "probabilidade-estatistica",
        "Probabilidade e Estatistica",
        "matematica",
        strong=[
            r"probabilidade", r"desvio padrao", r"\bvariancia\b", r"distribuicao normal",
            r"distribuicao binomial", r"distribuicao de poisson", r"teorema de bayes",
            r"esperanca matematica", r"valor esperado", r"variavel aleatoria",
            r"eventos independentes", r"espaco amostral", r"\bmediana\b", r"\bmoda\b",
            r"media aritmetica", r"intervalo de confianca", r"amostra aleatoria",
            r"funcao densidade", r"correlacao", r"regressao linear",
            r"\bmedia\b", r"\bpercentagem\b", r"\bpercentil\b", r"\bquartil\b",
            r"tempo medio", r"\bfrequencia relativa\b", r"\bhistograma de frequencia\b",
            r"\bchance\b", r"\bdesvio\b", r"\bamostra\b",
        ],
        weak=[r"\bdado\b.*\bface\b", r"\bmoeda\b", r"\bsorteio\b", r"\baleator", r"\bpontuacoes\b", r"\bpesquisa realizada\b"],
    ),
    Topic(
        "algebra-linear",
        "Algebra Linear",
        "matematica",
        strong=[
            r"\bmatriz\b", r"\bmatrizes\b", r"determinante", r"sistema de equacoes lineares",
            r"sistema linear", r"autovalor", r"autovetor", r"espaco vetorial", r"subespaco",
            r"transformacao linear", r"combinacao linear", r"linearmente independente",
            r"\bposto\b", r"matriz inversa", r"metodo de gauss", r"eliminacao gaussiana",
            r"escalonamento da matriz", r"base do espaco", r"\bnucleo\b.*\btransformacao\b",
            r"produto escalar", r"regra de cramer", r"matriz identidade", r"matriz transposta",
            r"\bvetores\b", r"produto interno", r"\bortonormal\b", r"\be uma base\b",
            r"\bdiagonalizavel\b", r"\bsistema homogeneo\b", r"\bgauss-?jordan\b",
            r"polinomio caracteristico", r"eliminacao de gauss", r"base padrao",
            r"coordenadas de .{0,20}na base", r"programacao linear", r"minimos quadrados",
            r"sistema de equacoes", r"\bproblema dual\b", r"melhor se ajusta",
            r"\breflexao atraves\b", r"\bcisalhamento\b", r"expansao uniforme",
            r"contracao uniforme", r"\btransformacao t\(",
        ],
        weak=[r"\bvetor\b", r"ortogonal", r"dimensao do espaco", r"\bindependentes\b", r"\bincognitas\b"],
    ),
    Topic(
        "calculo",
        "Calculo Diferencial e Integral",
        "matematica",
        strong=[
            r"\bderivada\b", r"derivadas", r"\bintegral\b", r"integrais",
            r"\blim\b", r"regra da cadeia", r"regra de l.?hopital", r"serie de taylor",
            r"serie de maclaurin", r"serie convergente", r"serie de potencias",
            r"teorema fundamental do calculo", r"ponto de inflexao", r"reta tangente",
            r"taxa de variacao", r"maximo local", r"minimo local", r"continuidade da funcao",
            r"funcao continua", r"\bconcavidade\b",
            r"\bantiderivada\b", r"\bprimitiva\b.*funcao", r"gradiente", r"derivada parcial",
            r"\bcontinua em\b", r"\bdescontinu", r"curva de nivel", r"esboco do grafico",
            r"funcao de classe c", r"f\(x, ?y\)", r"\bintegracao por partes\b",
            r"\bteorema do valor medio\b", r"\bponto critico\b", r"\bdiferenciavel\b",
            r"\bregra de simpson\b", r"\bregra do trapezio\b", r"\bmetodo de newton\b",
            r"\bderivavel\b", r"\bderivaveis\b", r"area da regiao", r"volume do solido",
            r"\bmaximiza\b", r"\bminimiza o\b", r"\bprimeiro quadrante\b",
            r"\bf\(t\)dt\b", r"\bdx\b", r"\bln x\b", r"\blimn\b", r"\bsequencia\b.*\bconverge",
            r"delimitada pelas curvas", r"\btaxa de\b.*\bvariando\b", r"\bsolido de revolucao\b",
            r"\brevolucao do grafico\b", r"\beixo x\b", r"\bpolinomio de taylor\b",
            r"valores criticos", r"\blimite em infinito\b", r"\bminimizar\b",
            r"menor quantidade possivel", r"\bmaximizar\b", r"\blogaritmo",
            r"\bfuncao logaritmica\b", r"\bfuncao exponencial\b", r"\be continua em\b",
            r"\bintervalos da funcao\b", r"\bcurvas\b", r"\bconverge", r"\bdiverge",
            r"espaco percorrido", r"aproximada pela funcao", r"estimada pela funcao",
            r"dada pela equacao", r"\bao longo do tempo t\b", r"\binstante t\b",
            r"\braizes reais\b", r"\braiz real\b", r"\btaxa\b.*\bpor dia\b",
            r"\bcusto total\b.*\bproduzir\b",
        ],
        weak=[r"\blimite\b", r"convergencia", r"\bassintota\b", r"\bcrescente\b", r"decrescente", r"\bintervalo\b.*\bfuncao\b"],
    ),
    Topic(
        "geometria-analitica",
        "Geometria Analitica",
        "matematica",
        strong=[
            r"geometria analitica", r"equacao da reta", r"equacao do plano",
            r"circunferencia", r"\belipse\b", r"\bparabola\b", r"\bhiperbole\b",
            r"distancia entre os pontos", r"coordenadas cartesianas", r"\bbaricentro\b",
            r"retas paralelas", r"retas perpendiculares", r"produto vetorial",
            r"numeros? complexos?", r"representacao polar", r"\bteorema de pitagoras\b",
            r"coordenadas polares", r"coordenadas retangulares", r"coordenadas esfericas",
            r"coordenadas cilindricas", r"\bcircunferencia\b", r"\bvetor normal\b",
            r"\bponto medio\b", r"vetor diretor", r"\bcoplanares\b", r"\bconica\b",
            r"equacao do circulo", r"raio do circulo", r"equacao da esfera",
            r"angulo formado entre", r"equacoes parametricas", r"coordenada cartesiana",
            r"interseccao das retas", r"intersecao das retas", r"pontos alinhados",
            r"distancia do ponto", r"distancia da origem", r"\bretas r e s\b",
            r"\breta que passa pelo", r"\breta r\b", r"\breta s\b", r"\bsemi-?reta\b",
            r"\bsegmento de reta\b", r"\bortogonais\b", r"\bprisma\b", r"\btridimensional\b",
            r"\bperpendicular a reta\b", r"\bparalela ao vetor\b", r"\bpendente m\b",
        ],
        weak=[r"\bplano cartesiano\b", r"\barea do triangulo\b", r"\bcoeficiente angular\b", r"\bradianos\b", r"\bseno\b", r"\bcosseno\b", r"\bplanos\b", r"\bretas\b"],
    ),
    # ------------------------------------------------------- transversal (mat/fund)
    Topic(
        "grafos",
        "Teoria dos Grafos",
        # straddles Matematica Discreta and Algoritmos; empirically 83% of
        # graph questions are asked in the Fundamentos block
        "fundamentos",
        strong=[
            r"\bgrafo\b", r"\bgrafos\b", r"\bvertice", r"\barestas?\b", r"grafo bipartido",
            r"grafo planar", r"caminho euleriano", r"circuito euleriano", r"hamiltoniano",
            r"arvore geradora minima", r"algoritmo de dijkstra", r"algoritmo de kruskal",
            r"algoritmo de prim", r"algoritmo de floyd", r"bellman-?ford", r"fluxo maximo",
            r"componente conexa", r"componentes conexos", r"coloracao de grafo",
            r"grau do vertice", r"matriz de adjacencia", r"lista de adjacencia",
            r"ordenacao topologica", r"caminho minimo", r"clique maxima",
        ],
        weak=[r"\bconexo\b", r"\bciclo\b", r"\bdigrafo\b", r"busca em largura", r"busca em profundidade", r"\bbfs\b", r"\bdfs\b"],
    ),
    # -------------------------------------------------------------- fundamentos
    Topic(
        "estruturas-de-dados",
        "Estruturas de Dados",
        "fundamentos",
        strong=[
            r"lista encadeada", r"lista ligada", r"lista duplamente", r"\bpilha\b", r"\bpilhas\b",
            r"\bfila\b", r"\bfilas\b", r"fila de prioridade", r"arvore binaria",
            r"arvore de busca", r"arvore avl", r"\bavl\b", r"arvore rubro-?negra",
            r"arvore\s*b\b", r"\bheap\b", r"tabela hash", r"tabela de dispersao", r"\bhashing\b",
            r"funcao de espalhamento", r"\btrie\b", r"\bdeque\b", r"\bLIFO\b", r"\bFIFO\b",
            r"percurso em ordem", r"pre-?ordem", r"pos-?ordem", r"\bnó raiz\b", r"\bno raiz\b",
            r"\bcolisao\b.*\bhash\b", r"enderecamento aberto", r"arvore balanceada",
            r"estruturas? de dados", r"\bcampo de pesquisa\b", r"\bchave de busca\b",
            r"arvore n-?aria", r"\barvore de segmentos\b", r"\bmatriz esparsa\b",
            r"\blista circular\b", r"\bnos internos\b", r"\baltura da arvore\b",
            r"notacao polonesa", r"\bposfixa", r"\binfixa", r"\bprefixa\b",
            r"lista linear", r"alocados sequencialmente", r"\bapontador\b",
            r"\bhuffman\b", r"\blzw\b", r"\bcodigos? de huffman\b",
        ],
        weak=[r"\barvore\b", r"\bnos\b", r"\bfolha\b", r"\bponteiro\b", r"\bvetor\b.*\bindice\b", r"\bregistros\b.*\bcampos\b"],
    ),
    Topic(
        "ordenacao-busca",
        "Ordenacao e Busca",
        "fundamentos",
        strong=[
            r"quick-?sort", r"merge-?sort", r"heap-?sort", r"bubble-?sort", r"insertion-?sort",
            r"selection-?sort", r"shell-?sort", r"radix-?sort", r"counting-?sort", r"bucket-?sort",
            r"ordenacao por insercao", r"ordenacao por selecao", r"ordenacao por troca",
            r"busca binaria", r"pesquisa binaria", r"busca sequencial", r"busca linear",
            r"algoritmo de ordenacao", r"metodo de ordenacao", r"ordenacao estavel",
        ],
        weak=[r"\bordenar\b", r"\bordenado\b", r"\bordenacao\b", r"\bpivo\b"],
    ),
    Topic(
        "complexidade",
        "Analise de Algoritmos e Complexidade",
        "fundamentos",
        strong=[
            r"complexidade de tempo", r"complexidade computacional", r"complexidade do algoritmo",
            r"notacao assintotica", r"notacao\s*o\b", r"\bbig-?o\b", r"\bo\(n", r"\bO\(1\)",
            r"\btheta\b", r"\bomega\b", r"pior caso", r"melhor caso", r"caso medio",
            r"\bnp-?completo", r"\bnp-?dificil", r"\bnp-?hard", r"\bnp-?completude", r"\bclasse p\b",
            r"programacao dinamica", r"divisao e conquista", r"algoritmo guloso", r"\bgreedy\b",
            r"\bbacktracking\b", r"teorema mestre", r"limite inferior do problema",
            r"tempo polinomial", r"\bintratavel\b", r"reducao polinomial", r"custo assintotico",
            r"\bassintotic", r"\bcomplexidade\b", r"\bordem de crescimento\b",
            r"analise de algoritmos", r"\bcusto computacional\b", r"\btempo de execucao\b",
            r"limitante inferior", r"limitante superior", r"\bo\(log", r"\bmochila\b",
            r"\bo\(n", r"\blog2? n\b", r"\blog n\b",
        ],
        weak=[r"\brecursivo\b", r"\brecursao\b", r"\beficiencia\b", r"numero de comparacoes", r"\blogaritmic", r"\bn log n\b"],
    ),
    Topic(
        "teoria-computacao",
        "Linguagens Formais, Automatos e Computabilidade",
        "fundamentos",
        strong=[
            r"\bautomato", r"\bautomatos\b", r"maquina de turing", r"linguagens? regulares?",
            r"expressoes? regulares?", r"gramatica livre de contexto", r"gramatica regular",
            r"linguagens? livres? de contexto", r"\bafd\b", r"\bafn\b", r"automato finito",
            r"lema do bombeamento", r"pumping lemma", r"problema da parada",
            r"recursivamente enumeravel", r"\bdecidivel\b", r"\bindecidivel\b",
            r"maquina de estados finit[ao]s?", r"automato com pilha", r"linguagem aceita",
            r"linguagens? formais", r"regras de producao", r"simbolo inicial",
            r"redes? de petri", r"\bpalavra gerada\b", r"\bderivada pela gramatica\b",
            r"\balfabeto\b.*\bcadeia", r"\bcadeias\b.*\blinguagem\b", r"forma normal de chomsky",
            r"hierarquia de chomsky", r"\bcomputabilidade\b", r"\bnao-?determinist",
        ],
        weak=[r"\bgramatica\b", r"\bderivacao\b", r"\bestado final\b", r"transicao de estado", r"\bcadeia\b", r"\bsimbolo terminal\b"],
    ),
    Topic(
        "arquitetura-computadores",
        "Arquitetura e Organizacao de Computadores",
        "fundamentos",
        strong=[
            r"\bpipeline\b", r"memoria cache", r"\bcache\b", r"\bregistrador", r"\bula\b",
            r"unidade logica e aritmetica", r"unidade de controle", r"\brisc\b", r"\bcisc\b",
            r"\bbarramento\b", r"modo de enderecamento", r"conjunto de instrucoes",
            r"\bassembly\b", r"\bmips\b", r"hierarquia de memoria", r"\bdma\b",
            r"ponto flutuante", r"\bieee 754\b", r"complemento de dois", r"\bbit de paridade\b",
            r"ciclos? de clock", r"\bmemoria principal\b", r"\bmemoria virtual cache\b",
            r"\bcpi\b", r"\bmips\b", r"\binterrupcao\b", r"\bpolling\b", r"acesso direto a memoria",
            r"\bcpu\b", r"\bmicroprocessador\b", r"\bregistradores\b", r"\brom\b", r"\bram\b",
            r"\bhexadecimal\b", r"\boctal\b", r"conversao de base", r"\bbase (?:2|8|16)\b",
            r"\bghz\b", r"\bmhz\b", r"\bvon neumann\b", r"\bmemoria cache\b", r"\bacerto\b.*\bcache\b",
            r"\bpalavra de memoria\b", r"\bunidade de armazenamento\b",
            r"\bmicrocodigo\b", r"\bmicroprograma", r"\bnivel de maquina\b",
            r"metodos de acesso", r"\benderecamento\b", r"\binterpretador do nivel\b",
        ],
        weak=[r"\bmemoria\b", r"\bclock\b", r"\bhardware\b", r"\bprocessador\b", r"\bbits\b", r"\bbyte", r"\bbinario\b", r"\bdecimal\b"],
    ),
    Topic(
        "circuitos-digitais",
        "Circuitos Digitais",
        "fundamentos",
        strong=[
            r"portas? logicas?", r"\bflip-?flops?\b", r"mapa de karnaugh",
            r"\bkarnaugh\b", r"\bmultiplexador\b", r"\bdemultiplexador\b", r"\bdecodificador\b",
            r"\bsomador\b", r"meio somador", r"\bcontador\b.*\b(?:circuito|frequencia|sincrono)\b",
            r"\blatch\b", r"circuitos? combinacionais?", r"circuitos? sequenciais?",
            r"algebra booleana", r"algebra de boole", r"leis de boole", r"\bboole\b",
            r"expressao booleana", r"\bnand\b", r"\bnor\b", r"\bxor\b", r"tabela de verdade do circuito",
            r"\bregistrador de deslocamento\b", r"\bminimizacao\b.*\bfuncao\b",
            r"circuitos? logicos?", r"saida logica", r"nivel logico", r"niveis logicos",
            r"\bmaquina de moore\b", r"\bmaquina de mealy\b", r"divisor de frequencia",
            r"\bminterm", r"termos minimos", r"don t care", r"\bmaxterm",
            r"expressoes? booleanas?", r"funcao dual", r"teorema de de ?morgan",
            r"circuito cmos", r"\bpld\b", r"\bsram\b", r"\bfpga\b", r"\bcpld\b",
            r"\bvariaveis logicas\b", r"circuito digital", r"circuito simplificado",
        ],
        weak=[r"\bbooleana\b", r"\bcircuito\b", r"\bsinal de entrada\b", r"\bsaida do circuito\b", r"\bentradas\b.*\bsaida\b"],
    ),
    Topic(
        "linguagens-programacao",
        "Linguagens de Programacao",
        "fundamentos",
        strong=[
            r"orientad[ao] a objetos", r"orientacao a objetos", r"\bpolimorfismo\b", r"\bheranca\b",
            r"\bencapsulamento\b", r"classe abstrata", r"\binterface\b.*\bclasse\b",
            r"passagem de parametro", r"passagem por valor", r"passagem por referencia",
            r"escopo de variavel", r"escopo estatico", r"escopo dinamico",
            r"paradigma funcional", r"paradigma imperativo", r"programacao funcional",
            r"programacao logica", r"\btipagem\b", r"tipagem estatica", r"tipagem dinamica",
            r"garbage collect", r"coleta de lixo", r"\blambda\b", r"\bclosure\b",
            r"sobrecarga de metodo", r"sobrescrita", r"\bponteiro\b", r"alocacao dinamica",
            r"\bjava\b", r"\bpython\b", r"\bc\+\+\b", r"linguagens? de programacao",
            r"sistema de tipos", r"\bpolimorfic", r"\bmonomorfic", r"\bsobrecarregada\b",
            r"\binferencia de tipos\b", r"\bavaliacao preguicosa\b", r"\bhaskell\b",
            r"\bconstrutor\b.*\bclasse\b", r"\bclasse abstrata\b", r"\bmodificador de acesso\b",
            r"\blisp\b", r"\bcar\b.{0,20}\bcdr\b", r"\bcdr\b", r"\bassociacoes\b",
            r"\bagregacoes\b", r"tipos de dados", r"tipos primitivos", r"tipos reais",
            r"\bpascal\b", r"\bcoercao\b", r"\bsobrecarga\b",
        ],
        weak=[r"\bmetodo\b", r"\bclasse\b", r"\bobjeto\b", r"\bcompilada\b", r"\binterpretada\b", r"\bvariavel local\b"],
    ),
    Topic(
        "programacao-algoritmos",
        "Programacao e Pseudocodigo",
        "fundamentos",
        strong=[
            r"pseudo-?codigo", r"o algoritmo abaixo", r"o programa abaixo",
            r"o trecho de codigo", r"o codigo abaixo", r"a funcao abaixo",
            r"qual a saida", r"qual e a saida", r"sera impresso", r"o valor impresso",
            r"apos a execucao", r"execucao do programa", r"\bfunca[oe]s? recursivas?\b",
            r"estruturas? de controle", r"programacao estruturada", r"refinamento sucessivo",
            r"\bmodulariza", r"decomposicao do problema", r"tecnica de programacao",
            r"\bselecao simples\b", r"\bcomando condicional\b", r"\blaco de repeticao\b",
            r"\bfluxograma\b", r"\bteste de mesa\b", r"programa escrito em",
            r"que imprime o programa", r"saida impressa", r"saida do programa",
            r"segmento de codigo", r"chamadas recursivas", r"\btypedef\b", r"\bprintf\b",
            r"\bint main\b", r"numero de iteracoes", r"estrutura de repeticao",
            r"teste de condicao", r"trecho de programa", r"\bpseudocodigo\b",
        ],
        weak=[r"\bcodigo\b", r"\balgoritmo\b", r"\blaco\b", r"\bloop\b", r"\bwhile\b", r"\bfor\b", r"\bimprime\b", r"\bretorna\b"],
    ),
    Topic(
        "engenharia-software",
        "Engenharia de Software",
        "tecnologia",
        strong=[
            r"engenharia de software", r"engenharia de requisitos", r"levantamento de requisitos",
            r"requisitos funcionais", r"requisitos nao[- ]funcionais", r"\buml\b",
            r"diagrama de classes", r"diagrama de casos de uso", r"caso de uso",
            r"diagrama de sequencia", r"testes? de software", r"teste unitario", r"teste de unidade",
            r"teste caixa branca", r"teste caixa preta", r"cobertura de codigo",
            r"testes? de regressao", r"casos? de teste", r"suite de testes",
            r"testes? de integracao", r"testes? de aceitacao", r"\bdebug", r"\bdepuracao\b",
            r"\bscrum\b", r"\bsprint\b", r"metodologia agil", r"metodos ageis", r"\bxp\b.*\bagil\b",
            r"modelo cascata", r"modelo espiral", r"modelo incremental", r"\bcmmi\b", r"\bmps.?br\b",
            r"padrao de projeto", r"design pattern", r"\bsingleton\b", r"\bobserver\b", r"\bfactory\b",
            r"\brefatoracao\b", r"ciclo de vida do software", r"manutencao de software",
            r"\bacoplamento\b", r"\bcoesao\b", r"verificacao e validacao", r"metricas de software",
            r"\bpontos de funcao\b", r"gerencia de configuracao", r"\bmvc\b",
            r"metodologia xp", r"\bprogramacao extrema\b", r"validacao de software",
            r"\bprototipacao\b", r"\bcasos? de uso\b", r"\bkanban\b", r"\bdevops\b",
        ],
        weak=[r"\brequisitos\b", r"\bsoftware\b", r"\bprojeto de sistema\b", r"\bmodelagem\b", r"\bstakeholder", r"\bdocumentacao\b"],
    ),
    # --------------------------------------------------------------- tecnologia
    Topic(
        "banco-de-dados",
        "Banco de Dados",
        "tecnologia",
        strong=[
            r"banco de dados", r"\bsql\b", r"\bselect\b.*\bfrom\b", r"chave primaria",
            r"chave estrangeira", r"\bnormalizacao\b", r"forma normal", r"\b[1-3]fn\b",
            r"algebra relacional", r"calculo relacional", r"modelo relacional",
            r"entidade[- ]relacionamento", r"\bmer\b", r"\bder\b", r"\btupla", r"\bsgbd\b",
            r"dependencia funcional", r"\btransacao\b", r"\bacid\b", r"controle de concorrencia",
            r"\bcommit\b", r"\brollback\b", r"\bdeadlock\b.*\btransac", r"\bnosql\b",
            r"\bindice\b.*\btabela\b", r"\bjuncao\b", r"\bjoin\b", r"\btrigger\b", r"\bview\b.*\btabela\b",
            r"\bgroup by\b", r"\bhaving\b", r"\bcardinalidade do relacionamento\b",
            r"\bintegridade referencial\b", r"\bdata warehouse\b", r"\bplano de execucao\b",
            r"\bserializavel\b", r"escalas de execucao", r"entradas de indice",
            r"execucao de transacoes", r"diagrama de entidades",
        ],
        weak=[r"\btabela\b", r"\bconsulta\b", r"\bregistro\b.*\btabela\b", r"\bchave candidata\b", r"\brelacao\b.*\batributo"],
    ),
    Topic(
        "sistemas-operacionais",
        "Sistemas Operacionais",
        # asked in both blocks (51 Fundamentos / 30 Tecnologia), which makes it
        # one of the highest-yield topics in the whole exam
        "fundamentos",
        strong=[
            r"sistema operacional", r"sistemas operacionais", r"\bescalonamento\b",
            r"escalonador", r"\bround-?robin\b", r"\bsjf\b", r"\bfcfs\b", r"\bdeadlock\b",
            r"impasse", r"\bsemaforo", r"\bmutex\b", r"exclusao mutua", r"secao critica",
            r"regiao critica", r"memoria virtual", r"\bpaginacao\b", r"\bsegmentacao\b.*\bmemoria\b",
            r"tabela de paginas", r"falta de pagina", r"\bpage fault\b", r"algoritmo lru",
            r"sistemas? de arquivos?", r"\binode\b", r"\bkernel\b", r"chamada de sistema",
            r"\bswap\b", r"troca de contexto", r"produtor-?consumidor", r"\bthread", r"\bprocessos\b",
            r"\bfork\b", r"\bpid\b", r"\bpreempti", r"\bstarvation\b", r"\bfragmentacao\b",
            r"\bmonitor\b.*\bconcorren", r"\bpcb\b", r"operacoes com arquivos",
            r"tipos de arquivos", r"acesso sequencial", r"armazenamento secundario",
            r"regiao critica em sistemas", r"\bmemoria secundaria\b", r"\bbuffer de disco\b",
        ],
        weak=[r"\bprocesso\b", r"\bconcorrencia\b", r"\brecurso compartilhado\b", r"\bbloqueado\b", r"\bcpu\b"],
    ),
    Topic(
        "redes-computadores",
        "Redes de Computadores",
        "tecnologia",
        strong=[
            r"redes de computadores", r"\btcp\b", r"\budp\b", r"\bip\b", r"\bhttp\b", r"\bdns\b",
            r"\bftp\b", r"\bsmtp\b", r"\bdhcp\b", r"\bnat\b", r"\bethernet\b", r"modelo osi",
            r"camada de rede", r"camada de transporte", r"camada de aplicacao", r"camada de enlace",
            r"camada fisica", r"\bpilha de protocolos\b", r"mascara de sub-?rede", r"\bsub-?rede\b",
            r"\broteamento\b", r"\broteador", r"\bswitch\b", r"endereco mac", r"\bsocket\b",
            r"\bpacote", r"\bquadro\b.*\brede\b", r"\bhandshake\b", r"\bcsma\b", r"\bvlan\b",
            r"\blargura de banda\b", r"\bcolisao\b.*\brede\b", r"\bmeio de transmissao\b",
            r"\bwi-?fi\b", r"\bieee 802\b", r"\bipv[46]\b", r"\bcidr\b", r"\bmodulacao\b",
            r"\bfirewall\b", r"controle de fluxo", r"\badsl\b", r"cable modem",
            r"\bbauds?\b", r"velocidade de sinalizacao", r"acesso residencial",
            r"cliente-?servidor", r"camada de sessao", r"camada de apresentacao",
            r"iso/?osi", r"\bsub-?redes\b", r"trocas? de mensagens", r"\btime-?outs?\b",
            r"\bretransmissao\b", r"\bprefixo\b.*\bendereco\b",
        ],
        weak=[r"\brede\b", r"\bprotocolo\b", r"\bcamada\b", r"\btransmissao\b", r"\bhost\b"],
    ),
    Topic(
        "sistemas-distribuidos",
        "Sistemas Distribuidos e Computacao Paralela",
        "tecnologia",
        strong=[
            r"sistemas distribuidos", r"sistema distribuido", r"\brpc\b", r"chamada remota",
            r"\bmiddleware\b", r"\bcorba\b", r"\breplicacao\b", r"\bconsistencia\b.*\breplic",
            r"tolerancia a falhas", r"relogio logico", r"relogios de lamport", r"\bcluster\b",
            r"eleicao de lider", r"\bmapreduce\b", r"\bhadoop\b", r"computacao em nuvem",
            r"\bcloud\b", r"\bgrid\b", r"\bescalabilidade\b", r"\bmpi\b", r"\bopenmp\b",
            r"lei de amdahl", r"\bspeedup\b", r"computacao paralela", r"\bparalelismo\b",
            r"\bmulticore\b", r"\bgpu\b", r"memoria compartilhada distribuida",
            r"\btransparencia\b.*\bdistribuid", r"\bteorema cap\b", r"\bcommit em duas fases\b",
            r"falha por omissao", r"tipos de falha", r"falha bizantina", r"\bmultiprocessador",
            r"executadas paralelamente", r"\bagentes identicos\b",
            r"passagem de token", r"anel logico", r"algoritmos distribuidos",
            r"\bexclusao mutua\b.*distribu", r"\bordenacao total\b",
        ],
        weak=[r"\bdistribuido\b", r"\bconcorrente\b", r"\bnos da rede\b", r"\bsincronizacao\b"],
    ),
    Topic(
        "compiladores",
        "Compiladores",
        "tecnologia",
        strong=[
            r"\bcompilador", r"analise lexica", r"analise sintatica", r"analise semantica",
            r"\bparser\b", r"\bparsing\b", r"analisador lexico", r"analisador sintatico",
            r"arvore sintatica", r"\bll\(1\)", r"\blr\(", r"\bslr\b", r"\blalr\b",
            r"descendente recursivo", r"ascendente\b.*\bsintatic", r"tabela de simbolos",
            r"codigo intermediario", r"codigo de tres enderecos", r"otimizacao de codigo",
            r"geracao de codigo", r"conjunto first", r"conjunto follow", r"\bgramatica ambigua\b",
            r"traducao dirigida pela sintaxe", r"acoes semanticas", r"producoes da gramatica",
            r"gramatica de atributos", r"atributos sintetizados", r"\bshift-?reduce\b",
            r"bloco basico", r"transformacao de codigo", r"esquema de traducao",
            r"\be\.val\b", r"\bt\.val\b",
            r"\bfases da compilacao\b", r"\blinker\b", r"\bmontador\b", r"\bpre-?processador\b",
            r"\bderivacao mais a esquerda\b", r"\brecuperacao de erro\b.*sintat",
        ],
        # "token" is only WEAK: it is a compiler term, but distributed-systems
        # questions talk about passing a token around a ring, and on its own it
        # was strong enough to pull those into Compiladores
        weak=[r"\bcompilacao\b", r"\blexema\b", r"\bnao-?terminal\b", r"\bproducao\b.*\bgramatica\b", r"\btoken"],
    ),
    Topic(
        "computacao-grafica",
        "Computacao Grafica",
        "tecnologia",
        strong=[
            r"computacao grafica", r"\brasteriza", r"\bray[- ]tracing\b", r"\btracado de raios\b",
            r"transformacao geometrica", r"coordenadas homogeneas", r"matriz de projecao",
            r"projecao perspectiva", r"projecao ortografica", r"\bz-?buffer\b",
            r"buffer de profundidade", r"\bcurva de bezier\b", r"\bbezier\b", r"\bb-?spline\b",
            r"\brecorte\b.*\bjanela\b", r"\bclipping\b", r"\bviewport\b", r"\bmalha de poligonos\b",
            r"\bmapeamento de textura\b", r"\bmodelo rgb\b", r"\bmodelo cmyk\b", r"\bhsv\b",
            r"\banti-?aliasing\b", r"\bshading\b", r"\bphong\b", r"\bopengl\b", r"\bvoxel\b",
            r"\brenderizacao\b", r"\bwireframe\b", r"fonte de luz", r"luz ambiente",
            r"\biluminacao\b", r"\bluz difusa\b", r"\bluz direcional\b", r"\bcena 3d\b",
            r"\bmodelo de cores\b", r"\bprimitivas graficas\b", r"\brotacao\b.*\btranslacao\b",
            r"projecao do ponto", r"\bmodelos graficos\b", r"\bbi-?dimensional\b",
        ],
        weak=[r"\bpixel", r"\bpoligono\b", r"\btextura\b", r"\bmodelagem 3d\b", r"\bcena\b"],
    ),
    Topic(
        "processamento-imagens",
        "Processamento de Imagens",
        "tecnologia",
        strong=[
            r"processamento de imagens", r"processamento digital de imagens",
            r"\bhistograma\b", r"equalizacao de histograma", r"\bconvolucao\b",
            r"filtro passa-?baixa", r"filtro passa-?alta", r"filtro de mediana", r"\bfiltro gaussiano\b",
            r"\bsegmentacao de imagem", r"\blimiariza", r"\bthreshold", r"\berosao\b", r"\bdilatacao\b",
            r"morfologia matematica", r"deteccao de bordas", r"\boperador de sobel\b", r"\bsobel\b",
            r"\bcanny\b", r"\bruido\b.*\bimagem\b", r"realce de imagem", r"\bescala de cinza\b",
            r"transformada de fourier", r"\bcompressao de imagem\b",
            r"analise de imagens", r"\bcontraste\b", r"\bihs\b", r"imagem em cores",
            r"\btonalidade\b", r"\bbitmaps?\b", r"\bpixels vizinhos\b", r"\bjpeg\b",
        ],
        weak=[r"\bimagem\b", r"\bimagens\b", r"\bfiltro\b", r"\bmascara\b.*\bvizinhanca\b"],
    ),
    Topic(
        "inteligencia-artificial",
        "Inteligencia Artificial",
        "tecnologia",
        strong=[
            r"inteligencia artificial", r"busca heuristica", r"\bheuristica\b",
            r"\balgoritmo a\*", r"\ba\*\b", r"busca em profundidade limitada", r"busca gulosa",
            r"mini-?max", r"poda alfa", r"rede neural", r"redes neurais", r"\bperceptron\b",
            r"raciocinio baseado em casos", r"encadeamento regressivo", r"encadeamento progressivo",
            r"sistemas? baseados? em regras", r"\bclausulas\b", r"\bunificacao\b",
            r"funcao heuristica", r"sistemas? especialista", r"base de regras",
            r"aprendizado de maquina", r"machine learning", r"aprendizado supervisionado",
            r"aprendizado nao supervisionado", r"\bsistema especialista\b", r"logica fuzzy",
            r"logica nebulosa", r"algoritmo genetico", r"algoritmos geneticos", r"\bprolog\b",
            r"\bagente inteligente\b", r"agentes inteligentes", r"\bbase de conhecimento\b",
            r"motor de inferencia", r"\bencadeamento para frente\b", r"\bk-?means\b",
            r"\barvore de decisao\b", r"\bclassificador\b", r"\bnaive bayes\b", r"\bsvm\b",
            r"\bretropropagacao\b", r"\bbackpropagation\b", r"\bdeep learning\b",
            r"\bmineracao de dados\b", r"\bdata mining\b", r"\bprocessamento de linguagem natural\b",
        ],
        weak=[r"\bagente\b", r"\baprendizado\b", r"\btreinamento\b", r"\bfuncao de ativacao\b", r"\bespaco de estados\b"],
    ),
    Topic(
        "ihc",
        "Interacao Humano-Computador",
        "tecnologia",
        strong=[
            r"interacao humano-?computador", r"\bihc\b", r"\busabilidade\b",
            r"interface de usuario", r"interfaces de usuario", r"projeto de interface",
            r"avaliacao de interface", r"\bavaliacao heuristica\b", r"\bergonomia\b",
            r"estilos de interacao", r"inspecao de usabilidade", r"experiencia do usuario",
            r"\bprototipos? de\b.*\binterface", r"\bdesign de interacao\b",
            r"\bacessibilidade\b", r"\bteste com usuarios\b",
        ],
        weak=[r"\bdesigner", r"\bmenu\b", r"\bwidget\b", r"\binterativo\b"],
    ),
    Topic(
        "sistemas-informacao",
        "Sistemas de Informacao",
        "tecnologia",
        strong=[
            r"sistemas de informacao", r"sistema de informacao", r"\berp\b", r"\bcrm\b",
            r"business intelligence", r"\bolap\b", r"\boltp\b", r"sistema de apoio a decisao",
            r"\bgovernanca de ti\b", r"\bitil\b", r"\bcobit\b", r"\bworkflow\b",
            r"gestao do conhecimento", r"\bbpm\b", r"processo de negocio",
            r"\bsistema transacional\b", r"\bsistema legado\b", r"\bti verde\b",
            r"gestao de documentos", r"ciclo de vida dos documentos", r"\bged\b",
        ],
        weak=[r"\borganizacao\b.*\binformacao\b", r"\bgestao\b", r"\bnegocio\b", r"\busuario final\b"],
    ),
    Topic(
        "seguranca-informacao",
        "Seguranca da Informacao",
        "tecnologia",
        strong=[
            r"seguranca da informacao", r"\bcriptografia\b", r"chave publica", r"chave privada",
            r"chave simetrica", r"criptografia assimetrica", r"\brsa\b", r"\baes\b", r"\bdes\b",
            r"assinatura digital", r"certificado digital", r"\bfuncao hash\b", r"\bmd5\b", r"\bsha-?[12]\b",
            r"\bautenticacao\b", r"\bautorizacao\b", r"controle de acesso", r"\bvulnerabilidade",
            r"\bmalware\b", r"\bphishing\b", r"\bsql injection\b", r"\bxss\b", r"\bnegacao de servico\b",
            r"\bddos\b", r"\bssl\b", r"\btls\b", r"\bvpn\b", r"\bconfidencialidade\b",
            r"\bintegridade\b.*\bdados\b", r"\bnao-?repudio\b", r"\bataque\b.*\bseguranca\b",
        ],
        weak=[r"\bseguranca\b", r"\bcifra\b", r"\bsenha\b", r"\bpermissao\b"],
    ),
    Topic(
        "web-sistemas-web",
        "Desenvolvimento Web",
        "tecnologia",
        strong=[
            r"\bhtml\b", r"\bcss\b", r"\bjavascript\b", r"\bxml\b", r"\bjson\b",
            r"\brest\b", r"\brestful\b", r"\bsoap\b", r"web service", r"servicos web",
            r"\bwsdl\b", r"\bservlet\b", r"\bajax\b", r"\bapi web\b", r"\bcookie\b",
            r"\bnavegador\b.*\bservidor\b", r"\bservidor web\b", r"\bapache\b", r"\bxpath\b",
            r"\bdtd\b", r"\bxslt\b", r"\bmicrosservico",
        ],
        weak=[r"\bweb\b", r"\binternet\b", r"\bsite\b", r"\bpagina\b"],
    ),
]

TOPIC_BY_SLUG = {t.slug: t for t in TOPICS}

_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "œ": "oe", "æ": "ae"}
# LaTeX PDFs from 2002-2007 emit diacritics as standalone glyphs before the
# base letter ("fun¸c˜ao", "gr´afico"), which survive NFKD as spacing
# modifiers. Deleting them outright yields the accent-free form we match on.
_STRAY_MARKS = "´˜¸ˆ¨`ˇ˘˚˝"


def normalize(text: str) -> str:
    for lig, repl in _LIGATURES.items():
        text = text.replace(lig, repl)
    # must happen BEFORE NFKD: these spacing modifiers decompose to
    # "space + combining mark", and dropping only the combining half would
    # leave the space behind, splitting "fun¸c˜ao" into "fun c ao" and
    # breaking every keyword in the pre-2008 LaTeX cadernos
    text = text.translate({ord(c): None for c in _STRAY_MARKS})
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    # OCR of the 2002/2003 booklets leaves runs of junk glyphs; collapsing all
    # non-alphanumerics to single spaces keeps \b anchors working predictably
    text = re.sub(r"[^a-z0-9()*+\-\\/.,;:_\s]", " ", text)
    return re.sub(r"\s+", " ", text)


@dataclass
class Classification:
    topics: list[str]
    scores: dict[str, int]


# a pattern repeated many times is stronger evidence than a single mention,
# but a question that says "matriz" 20 times is not 20x more about matrices
MAX_HITS_PER_PATTERN = 3
# a topic must clear this to be reported at all; one STRONG hit (3) qualifies,
# stray WEAK hits (1 each) do not
MIN_SCORE = 3
# a runner-up is reported as a secondary topic only if it is at least this
# close to the winner -- POSCOMP questions genuinely straddle topics
# ("complexidade de um algoritmo de ordenacao"), and a study tool is more
# useful listing both than silently picking one.
SECONDARY_RATIO = 0.6
MAX_TOPICS = 3


def score_text(text: str) -> dict[str, int]:
    norm = normalize(text)
    scores: dict[str, int] = {}
    for topic in TOPICS:
        total = 0
        for patterns, weight in ((topic.strong, STRONG), (topic.weak, WEAK)):
            for pattern in patterns:
                hits = len(re.findall(pattern, norm))
                if hits:
                    total += weight * min(hits, MAX_HITS_PER_PATTERN)
        if total:
            scores[topic.slug] = total
    return scores


def classify(text: str) -> Classification:
    scores = score_text(text)
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    if not ranked or ranked[0][1] < MIN_SCORE:
        return Classification(topics=[], scores=scores)

    best = ranked[0][1]
    cutoff = max(MIN_SCORE, best * SECONDARY_RATIO)
    topics = [slug for slug, score in ranked[:MAX_TOPICS] if score >= cutoff]
    return Classification(topics=topics, scores=scores)
