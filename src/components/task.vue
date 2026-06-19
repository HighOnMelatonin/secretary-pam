<script setup>
// Component for to store and display tasks
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
    <div ref="container" class="task-container"></div>
</template>
