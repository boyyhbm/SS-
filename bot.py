from telegram import Update
from telegram.ext import Updater, CommandHandler, MessageHandler, Filters, ConversationHandler, CallbackContext

# Степени состояния разговора
NAME, AGE, CURRENT_KD, LAST_SEASON_KD, PLAYER_ID = range(5)

def start(update: Update, context: CallbackContext) -> int:
    update.message.reply_text("Здравствуйте! Пожалуйста, введите ваше имя:")
    return NAME

def name(update: Update, context: CallbackContext) -> int:
    context.user_data['name'] = update.message.text
    update.message.reply_text("Спасибо! Теперь введите ваш возраст:")
    return AGE

def age(update: Update, context: CallbackContext) -> int:
    context.user_data['age'] = update.message.text
    update.message.reply_text("Отлично! Теперь введите ваш Кд на данный момент (сквад):")
    return CURRENT_KD

def current_kd(update: Update, context: CallbackContext) -> int:
    context.user_data['current_kd'] = update.message.text
    update.message.reply_text("Теперь введите ваш Кд прошлый сезон (сквад):")
    return LAST_SEASON_KD

def last_season_kd(update: Update, context: CallbackContext) -> int:
    context.user_data['last_season_kd'] = update.message.text
    update.message.reply_text("Наконец, введите ваше ID:")
    return PLAYER_ID

def player_id(update: Update, context: CallbackContext) -> int:
    context.user_data['player_id'] = update.message.text
    user_data = context.user_data
    
    application = (
        f"Новая заявка на вступление в клан:\n"
        f"Имя: {user_data['name']}\n"
        f"Возраст: {user_data['age']}\n"
        f"Кд на данный момент (сквад): {user_data['current_kd']}\n"
        f"Кд прошлый сезон (сквад): {user_data['last_season_kd']}\n"
        f"ID игрока: {user_data['player_id']}"
    )
    
    admin_id = 410538520
    context.bot.send_message(chat_id=admin_id, text=application)
    
    update.message.reply_text("Спасибо! Ваша заявка отправлена.")
    return ConversationHandler.END

def cancel(update: Update, context: CallbackContext) -> int:
    update.message.reply_text('Заявка отменена.')
    return ConversationHandler.END

def main() -> None:
    updater = Updater("7029908606:AAEm_hRez1_QK3MAl1uPnayvbG_a9Ac8H2Q")
    
    dispatcher = updater.dispatcher
    
    conv_handler = ConversationHandler(
        entry_points=[CommandHandler('start', start)],
        states={
            NAME: [MessageHandler(Filters.text & ~Filters.command, name)],
            AGE: [MessageHandler(Filters.text & ~Filters.command, age)],
            CURRENT_KD: [MessageHandler(Filters.text & ~Filters.command, current_kd)],
            LAST_SEASON_KD: [MessageHandler(Filters.text & ~Filters.command, last_season_kd)],
            PLAYER_ID: [MessageHandler(Filters.text & ~Filters.command, player_id)],
        },
        fallbacks=[CommandHandler('cancel', cancel)],
    )
    
    dispatcher.add_handler(conv_handler)
    
    updater.start_polling()
    updater.idle()

if __name__ == '__main__':
    main()