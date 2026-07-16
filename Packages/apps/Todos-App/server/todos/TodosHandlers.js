import * as TodosModel from './TodosModel.js';

const MAX_TITLE_LENGTH = 300;

const listTodosHandler = async (request, response) => {
    try {
        const todos = await TodosModel.listTodos(request.user.uid);
        return response.status(200).json({ error: false, todos });
    } catch (err) {
        return response.status(500).json({ error: true, message: 'Failed to list todos.' });
    }
};

const createTodoHandler = async (request, response) => {
    const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';

    if (!title || title.length > MAX_TITLE_LENGTH) {
        return response.status(400).json({ error: true, message: `Title must be 1-${MAX_TITLE_LENGTH} characters.` });
    }

    try {
        const todo = await TodosModel.createTodo(request.user.uid, title);
        return response.status(201).json({ error: false, todo });
    } catch (err) {
        return response.status(500).json({ error: true, message: 'Failed to create todo.' });
    }
};

const updateTodoHandler = async (request, response) => {
    const id = Number(request.params.id);

    if (!Number.isInteger(id)) {
        return response.status(400).json({ error: true, message: 'Invalid todo id.' });
    }

    const fields = {};

    if (typeof request.body?.title === 'string') {
        const title = request.body.title.trim();

        if (!title || title.length > MAX_TITLE_LENGTH) {
            return response.status(400).json({ error: true, message: `Title must be 1-${MAX_TITLE_LENGTH} characters.` });
        }

        fields.title = title;
    }

    if (typeof request.body?.done === 'boolean') {
        fields.done = request.body.done;
    }

    if (Object.keys(fields).length === 0) {
        return response.status(400).json({ error: true, message: 'Nothing to update.' });
    }

    try {
        const todo = await TodosModel.updateTodo(request.user.uid, id, fields);

        if (!todo) {
            return response.status(404).json({ error: true, message: 'Todo not found.' });
        }

        return response.status(200).json({ error: false, todo });
    } catch (err) {
        return response.status(500).json({ error: true, message: 'Failed to update todo.' });
    }
};

const deleteTodoHandler = async (request, response) => {
    const id = Number(request.params.id);

    if (!Number.isInteger(id)) {
        return response.status(400).json({ error: true, message: 'Invalid todo id.' });
    }

    try {
        const deleted = await TodosModel.deleteTodo(request.user.uid, id);

        if (!deleted) {
            return response.status(404).json({ error: true, message: 'Todo not found.' });
        }

        return response.status(200).json({ error: false });
    } catch (err) {
        return response.status(500).json({ error: true, message: 'Failed to delete todo.' });
    }
};

export { listTodosHandler, createTodoHandler, updateTodoHandler, deleteTodoHandler };
