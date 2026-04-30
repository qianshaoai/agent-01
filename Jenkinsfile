pipeline {
    agent any

    environment {
        APP_NAME    = 'o-app'
        DEPLOY_DIR  = '/www/wwwroot/o.qianshao.ai'
        APP_PORT    = '3000'
        NODE_ENV    = 'production'
        // 从 Jenkins Credentials 注入（ID 需与凭据页面一致）
        SUPABASE_URL              = credentials('agent01_SUPABASE_URL')
        SUPABASE_ANON_KEY         = credentials('agent01_SUPABASE_ANON_KEY')
        SUPABASE_SERVICE_ROLE_KEY = credentials('agent01_SUPABASE_SERVICE_ROLE_KEY')
        JWT_SECRET                = credentials('agent01_JWT_SECRET')
        VOLCENGINE_API_KEY        = credentials('agent01_VOLCENGINE_API_KEY')
        // 4.28up 体验版智能体（Coze）配置
        TRIAL_AGENT_001_BOT_ID    = credentials('agent01_TRIAL_AGENT_001_BOT_ID')
        TRIAL_AGENT_001_API_TOKEN = credentials('agent01_TRIAL_AGENT_001_API_TOKEN')
        TRIAL_AGENT_002_BOT_ID    = credentials('agent01_TRIAL_AGENT_002_BOT_ID')
        TRIAL_AGENT_002_API_TOKEN = credentials('agent01_TRIAL_AGENT_002_API_TOKEN')
        // 4.30up 元器智能体凭证（agent_003 → AGT-YUANQI-001 复用）
        TRIAL_AGENT_003_ASSISTANT_ID = credentials('agent01_TRIAL_AGENT_003_ASSISTANT_ID')
        TRIAL_AGENT_003_API_KEY      = credentials('agent01_TRIAL_AGENT_003_API_KEY')
    }

    // NodeJS 名称需与 Jenkins → Global Tool Configuration 中配置的名称一致
    tools {
        nodejs 'node'
    }

    options {
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {

        stage('Checkout') {
            steps {
                echo "==> 拉取代码 from GitHub"
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                echo "==> 安装依赖"
                sh 'node -v && npm -v'
                sh 'npm ci --include=dev'
            }
        }

        stage('Build') {
            steps {
                echo "==> 构建 Next.js（standalone 模式）"
                // NEXT_PUBLIC_* 变量在构建时内联到客户端 JS，必须在 build 阶段注入
                sh """
                    NODE_OPTIONS='--max-old-space-size=1536' \
                    NEXT_PUBLIC_SUPABASE_URL=${env.SUPABASE_URL} \
                    NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY} \
                    npm run build
                """
            }
        }

        stage('Migrate trial agents into agents table') {
            // 用线上 JWT_SECRET 把 trial 的 3 个 agent (AGT-COZE-001/002 + AGT-YUANQI-001)
            // 重新加密 api_key_enc 写入 supabase.agents。
            // 幂等：已存在按 agent_code UPDATE 6 列，agent_type/external_url/enabled/category_id
            // 保留原值不动。
            steps {
                echo "==> 用线上密钥重新加密 trial 3 个 agent"
                // 用 sh '...' 单引号 + $VAR 引用，让 Jenkins 自动 mask secret
                sh '''
                    NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
                    node scripts/migrate-trial-agents.mjs
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo "==> 部署到 ${DEPLOY_DIR}"
                sh """
                    # 复制 standalone 产物（目录已由宝塔创建）
                    cp -rf .next/standalone/. ${DEPLOY_DIR}/

                    # standalone 需要手动补充 static 和 public
                    mkdir -p ${DEPLOY_DIR}/.next/static ${DEPLOY_DIR}/public
                    cp -rf .next/static/. ${DEPLOY_DIR}/.next/static/
                    cp -rf public/.       ${DEPLOY_DIR}/public/

                    # 确保 ecosystem 配置在部署目录中
                    cp ecosystem.config.js ${DEPLOY_DIR}/ecosystem.config.js
                """
                // 用 writeFile 写入密钥，避免 sh Groovy 插值泄露 secret
                writeFile file: "${DEPLOY_DIR}/.env.local", text: """NEXT_PUBLIC_SUPABASE_URL=${env.SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${env.SUPABASE_SERVICE_ROLE_KEY}
JWT_SECRET=${env.JWT_SECRET}
VOLCENGINE_API_KEY=${env.VOLCENGINE_API_KEY}
TRIAL_AGENT_001_BOT_ID=${env.TRIAL_AGENT_001_BOT_ID}
TRIAL_AGENT_001_API_TOKEN=${env.TRIAL_AGENT_001_API_TOKEN}
TRIAL_AGENT_002_BOT_ID=${env.TRIAL_AGENT_002_BOT_ID}
TRIAL_AGENT_002_API_TOKEN=${env.TRIAL_AGENT_002_API_TOKEN}
TRIAL_AGENT_003_ASSISTANT_ID=${env.TRIAL_AGENT_003_ASSISTANT_ID}
TRIAL_AGENT_003_API_KEY=${env.TRIAL_AGENT_003_API_KEY}
"""
            }
        }

        stage('Start / Reload PM2') {
            steps {
                echo "==> SSH 到宿主机，用 PM2 启动或热重载应用"
                sshagent(['host-ssh-key']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no root@host.docker.internal '
                            cd ${DEPLOY_DIR}
                            pm2 delete aiq-app > /dev/null 2>&1 || true
                            if pm2 describe ${APP_NAME} > /dev/null 2>&1; then
                                pm2 reload ecosystem.config.js --update-env
                            else
                                pm2 start ecosystem.config.js
                            fi
                            pm2 save
                        '
                    """
                }
            }
        }

        stage('Health Check') {
            steps {
                echo "==> 健康检查"
                sshagent(['host-ssh-key']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no root@host.docker.internal '
                            sleep 5
                            curl -sf http://localhost:${APP_PORT} > /dev/null && \
                                echo "✅ 健康检查通过" || \
                                (echo "❌ 健康检查失败"; exit 1)
                        '
                    """
                }
            }
        }
    }

    post {
        success {
            echo "✅ 部署成功 — ${env.BUILD_URL}"
        }
        failure {
            echo "❌ 部署失败，请查看日志：${env.BUILD_URL}console"
        }
        always {
            cleanWs()
        }
    }
}
