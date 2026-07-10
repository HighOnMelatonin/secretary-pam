<script setup>
// Component to get new tasks
import { ref } from 'vue';
const emptyTask = {
    "Name": "",
    "Description": "",
    "Deadline": "",
    "Priority": 0,
    "Weight": 0
};

</script>

<template>
    <div ref="container" class="task-container">
        <div class="taskHeader">
            <input v-model="text" placeholder="Task">
            <button @click="fillTask">Add</button>
        </div>
    </div>
</template>
